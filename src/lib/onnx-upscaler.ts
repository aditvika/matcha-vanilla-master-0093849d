/**
 * True local AI photo upscaling with ONNX Runtime Web.
 *
 * Model: Real-ESRGAN "realesr-general-x4v3" (x4, lightweight, ~4.6MB) served
 * from /models. Inference runs on WebGPU when available and falls back to the
 * WASM (SIMD) backend. Large images are processed as overlapping tiles so the
 * memory footprint stays flat on mobile devices.
 */

const MODEL_URL = "/models/realesr-general-x4v3.onnx";
const MODEL_SCALE = 4;
const TILE = 192;
const OVERLAP = 12;

export type OrtBackend = "webgpu" | "wasm";

type OrtModule = typeof import("onnxruntime-web");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Session = any;

let ortPromise: Promise<OrtModule> | null = null;
let sessionPromise: Promise<{ session: Session; backend: OrtBackend }> | null = null;

async function loadOrt(): Promise<OrtModule> {
  if (!ortPromise) {
    ortPromise = import("onnxruntime-web").then((ort) => {
      const version = (ort.env as { versions?: { web?: string } }).versions?.web ?? "1.29.0";
      // The runtime .wasm binaries are pulled from the CDN that matches the
      // installed package version, so nothing heavy ships in the app bundle.
      ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`;
      ort.env.wasm.numThreads = 1;
      ort.env.logLevel = "error";
      return ort;
    });
  }
  return ortPromise;
}

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await loadOrt();
      const buffer = await fetch(MODEL_URL).then((r) => {
        if (!r.ok) throw new Error(`Could not load AI model (${r.status})`);
        return r.arrayBuffer();
      });
      const providers: OrtBackend[] =
        typeof navigator !== "undefined" && "gpu" in navigator ? ["webgpu", "wasm"] : ["wasm"];
      for (const backend of providers) {
        try {
          const session = await ort.InferenceSession.create(new Uint8Array(buffer), {
            executionProviders: [backend],
            graphOptimizationLevel: "all",
          });
          return { session, backend };
        } catch (error) {
          console.warn(`[onnx] ${backend} backend unavailable:`, error);
        }
      }
      throw new Error("No ONNX execution provider is available on this device");
    })().catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

/** Warms the model up (download + session creation) without running inference. */
export async function preloadUpscaleModel() {
  return getSession();
}

function tileRanges(size: number) {
  const ranges: { start: number; end: number }[] = [];
  if (size <= TILE) return [{ start: 0, end: size }];
  let start = 0;
  while (start < size) {
    const end = Math.min(size, start + TILE);
    ranges.push({ start, end });
    if (end >= size) break;
    start = end - OVERLAP;
  }
  return ranges;
}

async function yieldToUi() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Runs the model over `source` and returns a 4x reconstructed canvas.
 */
export async function aiUpscale(
  source: CanvasImageSource,
  width: number,
  height: number,
  onProgress?: (fraction: number) => void,
): Promise<{ canvas: HTMLCanvasElement; backend: OrtBackend }> {
  const ort = await loadOrt();
  const { session, backend } = await getSession();

  const input = document.createElement("canvas");
  input.width = width;
  input.height = height;
  const inCtx = input.getContext("2d", { willReadFrequently: true });
  if (!inCtx) throw new Error("Canvas 2D context unavailable");
  inCtx.drawImage(source, 0, 0, width, height);

  const out = document.createElement("canvas");
  out.width = width * MODEL_SCALE;
  out.height = height * MODEL_SCALE;
  const outCtx = out.getContext("2d");
  if (!outCtx) throw new Error("Canvas 2D context unavailable");

  const cols = tileRanges(width);
  const rows = tileRanges(height);
  const total = cols.length * rows.length;
  let done = 0;

  const inputName = session.inputNames?.[0] ?? "input";
  const outputName = session.outputNames?.[0] ?? "output";

  for (const row of rows) {
    for (const col of cols) {
      const tw = col.end - col.start;
      const th = row.end - row.start;
      const { data } = inCtx.getImageData(col.start, row.start, tw, th);

      const plane = tw * th;
      const tensorData = new Float32Array(plane * 3);
      for (let i = 0; i < plane; i += 1) {
        tensorData[i] = (data[i * 4] ?? 0) / 255;
        tensorData[plane + i] = (data[i * 4 + 1] ?? 0) / 255;
        tensorData[plane * 2 + i] = (data[i * 4 + 2] ?? 0) / 255;
      }

      const tensor = new ort.Tensor("float32", tensorData, [1, 3, th, tw]);
      const result = await session.run({ [inputName]: tensor });
      const output = result[outputName] ?? Object.values(result)[0];
      const values = output.data as Float32Array;
      const ow = tw * MODEL_SCALE;
      const oh = th * MODEL_SCALE;
      const oPlane = ow * oh;

      const rgba = new Uint8ClampedArray(oPlane * 4);
      for (let i = 0; i < oPlane; i += 1) {
        rgba[i * 4] = Math.max(0, Math.min(255, (values[i] ?? 0) * 255));
        rgba[i * 4 + 1] = Math.max(0, Math.min(255, (values[oPlane + i] ?? 0) * 255));
        rgba[i * 4 + 2] = Math.max(0, Math.min(255, (values[oPlane * 2 + i] ?? 0) * 255));
        rgba[i * 4 + 3] = 255;
      }

      const tileCanvas = document.createElement("canvas");
      tileCanvas.width = ow;
      tileCanvas.height = oh;
      tileCanvas.getContext("2d")?.putImageData(new ImageData(rgba, ow, oh), 0, 0);
      // Trim the overlap so seams never show in the composite.
      const trimL = col.start === 0 ? 0 : OVERLAP * MODEL_SCALE;
      const trimT = row.start === 0 ? 0 : OVERLAP * MODEL_SCALE;
      outCtx.drawImage(
        tileCanvas,
        trimL,
        trimT,
        ow - trimL,
        oh - trimT,
        col.start * MODEL_SCALE + trimL,
        row.start * MODEL_SCALE + trimT,
        ow - trimL,
        oh - trimT,
      );

      done += 1;
      onProgress?.(done / total);
      await yieldToUi();
    }
  }

  return { canvas: out, backend };
}

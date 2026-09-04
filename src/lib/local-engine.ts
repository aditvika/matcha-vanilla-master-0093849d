/**
 * Local processing entry point.
 *
 * Photos  -> ONNX Runtime Web (Real-ESRGAN, WebGPU/WASM)
 * Videos  -> FFmpeg WebAssembly inside a Web Worker
 *
 * Nothing here runs until the Supabase credit gate has approved the request.
 */

import { aiUpscale } from "./onnx-upscaler";
import { upscaleVideoLocally, type VideoResolution } from "./ffmpeg-video";

export type LocalMediaResult = {
  blob: Blob;
  extension: "png" | "mp4";
  contentType: "image/png" | "video/mp4";
};

export type LocalProgress = (fraction: number) => void;

const TARGET_HEIGHT = { "720p": 720, "1080p": 1080, "2K": 1440, "4K": 2160 } as const;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode the selected image"));
    };
    img.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas encoder returned no output"))),
      type,
    );
  });
}

/** Fast, dependency-free Canvas 2D progressive upscale + sharpening. */
function canvasUpscale(
  image: HTMLImageElement,
  outW: number,
  outH: number,
  onProgress?: LocalProgress,
): HTMLCanvasElement {
  let current = document.createElement("canvas");
  current.width = image.naturalWidth;
  current.height = image.naturalHeight;
  current.getContext("2d")?.drawImage(image, 0, 0);

  // Step up in 1.5x increments for smoother reconstruction than one big jump.
  let steps = 0;
  const totalSteps = Math.max(1, Math.ceil(Math.log(outW / current.width) / Math.log(1.5)));
  while (current.width < outW) {
    const w = Math.min(outW, Math.round(current.width * 1.5));
    const h = Math.min(outH, Math.round(current.height * 1.5));
    const next = document.createElement("canvas");
    next.width = w;
    next.height = h;
    const ctx = next.getContext("2d");
    if (!ctx) break;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(current, 0, 0, w, h);
    current = next;
    steps += 1;
    onProgress?.(Math.min(0.9, steps / totalSteps));
  }

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(current, 0, 0, outW, outH);

  // Light unsharp mask via convolution on the final frame.
  try {
    const img = ctx.getImageData(0, 0, outW, outH);
    const src = img.data;
    const copy = new Uint8ClampedArray(src);
    const k = [0, -0.25, 0, -0.25, 2, -0.25, 0, -0.25, 0];
    for (let y = 1; y < outH - 1; y += 1) {
      for (let x = 1; x < outW - 1; x += 1) {
        for (let c = 0; c < 3; c += 1) {
          let sum = 0;
          let i = 0;
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1, i += 1) {
              sum += (copy[((y + dy) * outW + (x + dx)) * 4 + c] ?? 0) * (k[i] ?? 0);
            }
          }
          src[(y * outW + x) * 4 + c] = Math.max(0, Math.min(255, sum));
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  } catch {
    // Sharpening is optional; a tainted or huge canvas simply skips it.
  }
  onProgress?.(1);
  return out;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function upscalePhoto(
  file: File,
  resolution: VideoResolution,
  onProgress?: LocalProgress,
): Promise<LocalMediaResult> {
  const image = await loadImage(file);
  const srcW = image.naturalWidth;
  const srcH = image.naturalHeight;
  const target = TARGET_HEIGHT[resolution];

  const finalScaleDirect = target / Math.min(srcW, srcH);
  const directW = Math.max(1, Math.round(srcW * finalScaleDirect));
  const directH = Math.max(1, Math.round(srcH * finalScaleDirect));

  let out: HTMLCanvasElement;
  try {
    // Cap the model input so a huge phone photo does not explode memory.
    const maxInputShortEdge = Math.ceil(target / 4);
    const preScale = Math.min(1, maxInputShortEdge / Math.min(srcW, srcH));
    const inW = Math.max(32, Math.round(srcW * preScale));
    const inH = Math.max(32, Math.round(srcH * preScale));

    const { canvas: ai } = await withTimeout(
      aiUpscale(image, inW, inH, (f) => onProgress?.(f * 0.9)),
      120_000,
      "AI upscaler",
    );

    const finalScale = target / Math.min(ai.width, ai.height);
    const outW = Math.round(ai.width * finalScale);
    const outH = Math.round(ai.height * finalScale);

    out = document.createElement("canvas");
    out.width = outW;
    out.height = outH;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(ai, 0, 0, outW, outH);
  } catch (error) {
    // Mobile GPUs/WASM can fail or hang: never leave the user at 0%.
    console.warn("[local-engine] AI upscaler unavailable, using Canvas 2D:", error);
    out = canvasUpscale(image, directW, directH, (f) => onProgress?.(f));
  }
  onProgress?.(1);

  const blob = await canvasBlob(out, "image/png");
  if (!blob || blob.size === 0) throw new Error("Encoder produced an empty image");

  return {
    blob,
    extension: "png",
    contentType: "image/png",
  };
}


export async function processMediaLocally(
  file: File,
  kind: "photo" | "video",
  resolution: VideoResolution,
  onProgress?: LocalProgress,
): Promise<LocalMediaResult> {
  if (kind === "photo") return upscalePhoto(file, resolution, onProgress);
  return upscaleVideoLocally(file, resolution, onProgress);
}

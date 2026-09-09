/**
 * Media processing service wrapper.
 *
 * The UI, Supabase credit handling and error states talk ONLY to this module.
 * Swapping the execution engine later (e.g. native Capacitor plugins in the
 * APK build) means replacing `photoEngine` / `videoEngine` here — no UI or
 * credit-logic rewrite.
 *
 * DUAL-TARGET ARCHITECTURE
 * ------------------------
 * `EXECUTION_TARGET` selects where media processing actually runs:
 *
 *  - 'web'    (default, current browser trial)
 *             Photos → Supabase storage transformation + client sharpening.
 *             Videos → local FFmpeg WASM full-length 720p encode.
 *  - 'native' (future Capacitor APK)
 *             Photos/Videos → native TFLite/ONNX engine injected through
 *             `nativeTflitePhoto` / `nativeTfliteVideo`. Until a native
 *             engine is provided, both safely fall back to the web pipeline.
 *
 * The UI (`src/routes/processing.tsx`), the pre-deduction in
 * `media-pipeline.functions.ts` and the automatic `refundLocalRun` catch path
 * are all target-agnostic: they call `processPhoto` / `processVideo` and are
 * never aware of which target satisfied the request.
 */

import { transformPhoto } from "./photo-transform.functions";
import { upscaleVideoLocally, type VideoResolution } from "./ffmpeg-video";
import { PHOTO_PACE, VIDEO_PACE, startPacer } from "./progress-pacer";
import { sharpenPhotoBlob } from "./photo-sharpen";


export type Resolution = VideoResolution;

export type ProcessedMedia = {
  blob: Blob;
  extension: "jpg" | "png" | "mp4";
  contentType: string;
};

export type ProcessOptions = {
  file: File;
  /** Storage path of the already-uploaded source. */
  sourcePath: string;
  resolution: Resolution;
  onProgress?: (fraction: number) => void;
  onStatus?: (status: string) => void;
  /** Injectable server caller (useServerFn wrapper) for auth-attached calls. */
  transform?: typeof transformPhoto;
  /** Abort signal wired to the hard engine timeout. */
  signal?: AbortSignal;
};

export type MediaEngine = (options: ProcessOptions) => Promise<ProcessedMedia>;

/**
 * Execution target switcher.
 *
 * Defaults to 'web' for the current browser trial. When the Capacitor APK
 * build lands, set `VITE_EXECUTION_TARGET=native` (or flip the literal below)
 * and inject real TFLite/ONNX implementations into the native stubs — nothing
 * else in the app changes.
 */
export type ExecutionTarget = "web" | "native";

export const EXECUTION_TARGET: ExecutionTarget = (() => {
  const raw = typeof import.meta !== "undefined" ? import.meta.env?.VITE_EXECUTION_TARGET : undefined;
  return raw === "native" ? "native" : "web";
})();

function extensionFor(type: string): ProcessedMedia["extension"] {
  if (type.includes("png")) return "png";
  return "jpg";
}

/**
 * Hard engine deadlines. If the engine has not resolved by then, the
 * AbortController fires (cancelling any in-flight fetch) and a
 * "Processing timeout" error is thrown so the caller's catch block —
 * and its automatic credit refund — always executes.
 */
const PHOTO_TIMEOUT_MS = 120_000;
// Full-length encodes legitimately take minutes; the engine has its own
// stall detector, this is only the absolute ceiling.
const VIDEO_TIMEOUT_MS = 8 * 60_000;


/* ------------------------------------------------------------------ */
/* WEB ENGINES (current browser trial)                                 */
/* ------------------------------------------------------------------ */

/**
 * WEB PHOTO ENGINE — server-side transformation/sharpening endpoint.
 * No browser ONNX/WebGL: the browser only downloads the rendered result.
 */
const webPhotoEngine: MediaEngine = async ({
  sourcePath,
  resolution,
  onStatus,
  transform = transformPhoto,
  signal,
}) => {
  const throwIfAborted = () => {
    if (signal?.aborted) throw new Error("Processing timeout");
  };
  onStatus?.("Cloud server enhancement — rendering your photo...");
  const result = await transform({ data: { path: sourcePath, resolution } });
  throwIfAborted();
  if (!result?.ok) {
    throw new Error(result?.message || "Photo engine failed");
  }

  const response = await fetch(result.url, { signal });
  if (!response.ok) throw new Error(`Could not download the enhanced photo (${response.status})`);
  const blob = await response.blob();
  throwIfAborted();
  if (!blob || blob.size < 1024) throw new Error("Enhanced photo output was empty");

  const contentType = blob.type || "image/jpeg";
  onStatus?.("Applying detail sharpening...");
  const sharpened = await sharpenPhotoBlob(blob, contentType);
  const finalType = sharpened.type || contentType;
  return { blob: sharpened, extension: extensionFor(finalType), contentType: finalType };
};

/**
 * WEB VIDEO ENGINE — full-length, no truncation. Free tier targets 720p so
 * long clips stay inside a safe encoding envelope while keeping every second
 * of the original input and its audio track.
 */
const webVideoEngine: MediaEngine = async ({ file, resolution, onProgress, onStatus, signal }) => {
  onStatus?.("Video engine — preparing full-length encode...");
  const target: Resolution = resolution === "720p" ? "720p" : resolution;
  const out = await upscaleVideoLocally(file, target, onProgress, signal);
  if (!out.blob || out.blob.size < 1024) throw new Error("Video output was empty");
  return out;
};


/* ------------------------------------------------------------------ */
/* NATIVE ENGINES (future Capacitor APK — TFLite / ONNX)               */
/* ------------------------------------------------------------------ */

/**
 * Native engine handle. A future Capacitor build injects its real TFLite/ONNX
 * implementation here (e.g. via `setNativeEngines({ photo: ..., video: ... })`
 * at app startup). The signature is identical to a web `MediaEngine`, so the
 * shared `run()` wrapper — timeouts, pacing, aborts — applies unchanged.
 */
export type NativeEngines = {
  photo?: MediaEngine;
  video?: MediaEngine;
};

let nativeEngines: NativeEngines = {};

/** Called once by the native shell to inject real on-device engines. */
export function setNativeEngines(engines: NativeEngines) {
  nativeEngines = engines;
}

/**
 * NATIVE PHOTO STUB — placeholder for the future on-device TFLite/ONNX
 * Real-ESRGAN engine. Falls back to the web pipeline until injected.
 */
const nativeTflitePhoto: MediaEngine = async (options) => {
  if (nativeEngines.photo) return nativeEngines.photo(options);
  options.onStatus?.("Native engine not installed — using cloud server...");
  return webPhotoEngine(options);
};

/**
 * NATIVE VIDEO STUB — placeholder for the future on-device video engine.
 * Falls back to the web pipeline until injected.
 */
const nativeTfliteVideo: MediaEngine = async (options) => {
  if (nativeEngines.video) return nativeEngines.video(options);
  options.onStatus?.("Native engine not installed — using web encode...");
  return webVideoEngine(options);
};

/* ------------------------------------------------------------------ */
/* UNIFIED DISPATCH (target switch lives here, nowhere else)           */
/* ------------------------------------------------------------------ */

const photoEngine: MediaEngine =
  EXECUTION_TARGET === "native" ? nativeTflitePhoto : webPhotoEngine;

const videoEngine: MediaEngine =
  EXECUTION_TARGET === "native" ? nativeTfliteVideo : webVideoEngine;

async function run(engine: MediaEngine, options: ProcessOptions, kind: "photo" | "video") {
  const pacer = startPacer(kind === "photo" ? PHOTO_PACE : VIDEO_PACE, (f) =>
    options.onProgress?.(f),
  );
  const controller = new AbortController();
  const timeoutMs = kind === "video" ? VIDEO_TIMEOUT_MS : PHOTO_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await engine({
      ...options,
      signal: controller.signal,
      onProgress: (f) => pacer.report(f),
    });
    // Engine completion is not delivery completion. Keep 100% reserved for
    // the caller after upload, signing, and credit transaction all succeed.
    pacer.stop();
    options.onProgress?.(0.96);
    return result;
  } catch (error) {
    pacer.stop();
    // Normalize aborts into a clean timeout error so the caller refunds + toasts.
    if (controller.signal.aborted) throw new Error("Processing timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function processPhoto(options: ProcessOptions): Promise<ProcessedMedia> {
  return run(photoEngine, options, "photo");
}

export function processVideo(options: ProcessOptions): Promise<ProcessedMedia> {
  return run(videoEngine, options, "video");
}

/** Single dispatch helper kept for call sites that switch on media kind. */
export function processMedia(
  kind: "photo" | "video",
  options: ProcessOptions,
): Promise<ProcessedMedia> {
  return kind === "photo" ? processPhoto(options) : processVideo(options);
}

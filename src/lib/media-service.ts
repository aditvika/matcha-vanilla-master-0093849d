/**
 * Media processing service wrapper.
 *
 * The UI, Supabase credit handling and error states talk ONLY to this module.
 * Swapping the execution engine later (e.g. native Capacitor plugins in the
 * APK build) means replacing `photoEngine` / `videoEngine` here — no UI or
 * credit-logic rewrite.
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
};

export type MediaEngine = (options: ProcessOptions) => Promise<ProcessedMedia>;

function extensionFor(type: string): ProcessedMedia["extension"] {
  if (type.includes("png")) return "png";
  return "jpg";
}

/**
 * PHOTO ENGINE — server-side transformation/sharpening endpoint.
 * No browser ONNX/WebGL: the browser only downloads the rendered result.
 */
const photoEngine: MediaEngine = async ({
  sourcePath,
  resolution,
  onStatus,
  transform = transformPhoto,
}) => {
  onStatus?.("Cloud server enhancement — rendering your photo...");
  const result = await transform({ data: { path: sourcePath, resolution } });
  if (!result?.ok) {
    throw new Error(result?.message || "Photo engine failed");
  }

  const response = await fetch(result.url);
  if (!response.ok) throw new Error(`Could not download the enhanced photo (${response.status})`);
  const blob = await response.blob();
  if (!blob || blob.size < 1024) throw new Error("Enhanced photo output was empty");

  const contentType = blob.type || "image/jpeg";
  onStatus?.("Applying detail sharpening...");
  const sharpened = await sharpenPhotoBlob(blob, contentType);
  const finalType = sharpened.type || contentType;
  return { blob: sharpened, extension: extensionFor(finalType), contentType: finalType };
};


/**
 * VIDEO ENGINE — full-length, no truncation. Free tier targets 720p so long
 * clips stay inside a safe encoding envelope while keeping every second of
 * the original input and its audio track.
 */
const videoEngine: MediaEngine = async ({ file, resolution, onProgress, onStatus }) => {
  onStatus?.("Video engine — preparing full-length encode...");
  const target: Resolution = resolution === "720p" ? "720p" : resolution;
  const out = await upscaleVideoLocally(file, target, onProgress);
  if (!out.blob || out.blob.size < 1024) throw new Error("Video output was empty");
  return out;
};

async function run(engine: MediaEngine, options: ProcessOptions, kind: "photo" | "video") {
  const pacer = startPacer(kind === "photo" ? PHOTO_PACE : VIDEO_PACE, (f) =>
    options.onProgress?.(f),
  );
  try {
    const result = await engine({ ...options, onProgress: (f) => pacer.report(f) });
    pacer.finish();
    return result;
  } catch (error) {
    pacer.stop();
    throw error;
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

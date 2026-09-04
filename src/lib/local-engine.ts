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

async function upscalePhoto(
  file: File,
  resolution: VideoResolution,
  onProgress?: LocalProgress,
): Promise<LocalMediaResult> {
  const image = await loadImage(file);
  const srcW = image.naturalWidth;
  const srcH = image.naturalHeight;
  const target = TARGET_HEIGHT[resolution];

  // Cap the model input so a huge phone photo does not explode memory: the AI
  // pass reconstructs 4x, then we fit exactly to the requested resolution.
  const maxInputShortEdge = Math.ceil(target / 4);
  const preScale = Math.min(1, maxInputShortEdge / Math.min(srcW, srcH));
  const inW = Math.max(32, Math.round(srcW * preScale));
  const inH = Math.max(32, Math.round(srcH * preScale));

  const { canvas: ai } = await aiUpscale(image, inW, inH, (f) => onProgress?.(f * 0.9));

  const finalScale = target / Math.min(ai.width, ai.height);
  const outW = Math.round(ai.width * finalScale);
  const outH = Math.round(ai.height * finalScale);

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(ai, 0, 0, outW, outH);
  onProgress?.(1);

  return {
    blob: await canvasBlob(out, "image/png"),
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

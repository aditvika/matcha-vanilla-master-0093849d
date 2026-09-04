/**
 * Local video processing with FFmpeg compiled to WebAssembly.
 *
 * The whole transcode runs inside a dedicated Web Worker (@ffmpeg/ffmpeg spawns
 * one for us), so the main thread stays responsive and progress is reported in
 * real time. This replaces the old `video.currentTime` seek loop + MediaRecorder
 * capture, which deadlocked and dropped frames on mobile.
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

const CORE_BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

let ffmpegPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        // Worker glue is served from /ffmpeg so bundling never rewrites it.
        classWorkerURL: "/ffmpeg/worker.js",
        coreURL: `${CORE_BASE}/ffmpeg-core.js`,
        wasmURL: `${CORE_BASE}/ffmpeg-core.wasm`,
      });
      return ffmpeg;
    })().catch((error) => {
      ffmpegPromise = null;
      throw error;
    });
  }
  return ffmpegPromise;
}

/** Warms the FFmpeg worker + wasm core. */
export async function preloadVideoEngine() {
  return getFFmpeg();
}

const TARGET_HEIGHT = {
  "720p": 720,
  "1080p": 1080,
  "2K": 1440,
  "4K": 2160,
} as const;

export type VideoResolution = keyof typeof TARGET_HEIGHT;

export async function upscaleVideoLocally(
  file: File,
  resolution: VideoResolution,
  onProgress?: (fraction: number) => void,
): Promise<{ blob: Blob; extension: "mp4"; contentType: "video/mp4" }> {
  const ffmpeg = await getFFmpeg();
  const height = TARGET_HEIGHT[resolution];

  const handleProgress = ({ progress }: { progress: number }) => {
    if (Number.isFinite(progress)) onProgress?.(Math.max(0, Math.min(1, progress)));
  };
  ffmpeg.on("progress", handleProgress);

  const inputName = "input.bin";
  const outputName = "output.mp4";

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    const code = await ffmpeg.exec([
      "-i",
      inputName,
      "-vf",
      // Lanczos resampling + a light unsharp pass reconstructs far more detail
      // than canvas bilinear scaling, with even width/height for H.264.
      `scale=-2:${height}:flags=lanczos,unsharp=5:5:0.8:3:3:0.4`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      // Keep the original audio track exactly as authored (CapCut edits etc.).
      "-c:a",
      "copy",
      outputName,
    ]);

    if (code !== 0) throw new Error(`FFmpeg exited with code ${code}`);

    const data = await ffmpeg.readFile(outputName);
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    onProgress?.(1);
    return {
      blob: new Blob([bytes as unknown as BlobPart], { type: "video/mp4" }),
      extension: "mp4",
      contentType: "video/mp4",
    };
  } finally {
    ffmpeg.off("progress", handleProgress);
    await ffmpeg.deleteFile(inputName).catch(() => undefined);
    await ffmpeg.deleteFile(outputName).catch(() => undefined);
  }
}

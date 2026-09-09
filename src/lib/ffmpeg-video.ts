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

function isMobile() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

// Full-length inputs are always honoured — we never truncate a user's clip.
// Mobile safety comes from capping the output height instead.
const MOBILE_MAX_HEIGHT = 720;

/** Hard wall-clock cap for one encode, plus a "no progress" stall cap. */
const HARD_DEADLINE_MS = 8 * 60_000;
const STALL_MS = 90_000;

export async function upscaleVideoLocally(
  file: File,
  resolution: VideoResolution,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ blob: Blob; extension: "mp4"; contentType: "video/mp4" }> {
  const mobile = isMobile();

  const ffmpeg = await getFFmpeg();
  const requested = TARGET_HEIGHT[resolution];
  const height = mobile ? Math.min(requested, MOBILE_MAX_HEIGHT) : requested;

  let lastFraction = -1;
  let lastMove = Date.now();

  const handleProgress = ({ progress }: { progress: number }) => {
    if (!Number.isFinite(progress)) return;
    const f = Math.max(0, Math.min(1, progress));
    // A genuine forward move resets the stall watchdog.
    if (f > lastFraction + 0.0005) {
      lastFraction = f;
      lastMove = Date.now();
    }
    // Always forward the fraction: the UI layer uses it as a liveness signal
    // too, so a slow-but-working encode never looks frozen.
    onProgress?.(Math.max(0, lastFraction));
  };
  ffmpeg.on("progress", handleProgress);

  // FFmpeg emits log lines continuously even when the progress fraction has
  // not advanced yet (muxing, long GOPs). Those count as "alive".
  const handleLog = () => {
    lastMove = Date.now();
  };
  ffmpeg.on("log", handleLog);


  const inputName = "input.bin";
  const outputName = "output.mp4";

  // Any abort/timeout must kill the worker, otherwise the promise never settles.
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let failure: Error | undefined;
  const abort = (error: Error) => {
    if (failure) return;
    failure = error;
    try {
      ffmpeg.terminate();
    } catch {
      /* worker already gone */
    }
    ffmpegPromise = null;
  };
  const onExternalAbort = () => abort(new Error("Processing timeout"));
  signal?.addEventListener("abort", onExternalAbort);

  try {
    if (signal?.aborted) throw new Error("Processing timeout");
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    const started = Date.now();
    watchdog = setInterval(() => {
      if (Date.now() - started > HARD_DEADLINE_MS) {
        abort(new Error("Encoding melebihi batas waktu maksimum."));
      } else if (Date.now() - lastMove > STALL_MS) {
        abort(new Error("Encoding berhenti merespons."));
      }
    }, 2000);

    const filter = mobile
      ? `scale=-2:${height}:flags=bicubic`
      : `scale=-2:${height}:flags=lanczos,unsharp=5:5:0.8:3:3:0.4`;

    const code = await ffmpeg.exec([
      "-i",
      inputName,
      "-vf",
      filter,
      "-c:v",
      "libx264",
      "-preset",
      mobile ? "ultrafast" : "veryfast",
      "-crf",
      mobile ? "24" : "20",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      // Re-encode audio to AAC so any source codec lands cleanly in MP4.
      "-c:a",
      "aac",
      "-b:a",
      "192k",

      outputName,
    ]);

    if (failure) throw failure;
    if (code !== 0) throw new Error(`FFmpeg exited with code ${code}`);

    const data = await ffmpeg.readFile(outputName);
    if (failure) throw failure;
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    if (!bytes || bytes.byteLength < 1024) {
      throw new Error("Hasil video tidak valid (file kosong). Coba klip yang lebih pendek.");
    }
    onProgress?.(1);
    return {
      blob: new Blob([bytes as unknown as BlobPart], { type: "video/mp4" }),
      extension: "mp4",
      contentType: "video/mp4",
    };
  } catch (error) {
    throw failure ?? error;
  } finally {
    if (watchdog) clearInterval(watchdog);
    signal?.removeEventListener("abort", onExternalAbort);
    if (!failure) {
      ffmpeg.off("progress", handleProgress);
      await ffmpeg.deleteFile(inputName).catch(() => undefined);
      await ffmpeg.deleteFile(outputName).catch(() => undefined);
    }
  }
}



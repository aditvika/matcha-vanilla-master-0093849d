export type LocalMediaResult = {
  blob: Blob;
  extension: "png" | "webm";
  contentType: "image/png" | "video/webm";
};

export type LocalProgress = (fraction: number) => void;

const HEIGHTS = { "720p": 720, "1080p": 1080, "2K": 1440, "4K": 2160 } as const;

function outputSize(width: number, height: number, resolution: keyof typeof HEIGHTS) {
  const shortEdge = HEIGHTS[resolution];
  const scale = Math.max(1, shortEdge / Math.min(width, height));
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas encoder returned no output"))),
      type,
      quality,
    );
  });
}

/**
 * Progressive (step) upscaling: repeatedly enlarge by <=2x so bilinear
 * resampling keeps far more detail than a single large jump.
 */
function stepScale(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  stepFactor = 2,
): HTMLCanvasElement {
  let curW = srcW;
  let curH = srcH;
  let current = document.createElement("canvas");
  current.width = curW;
  current.height = curH;
  const c0 = current.getContext("2d");
  if (!c0) throw new Error("Canvas processing is unavailable");
  c0.drawImage(source, 0, 0, curW, curH);

  while (curW < dstW || curH < dstH) {
    const nextW = Math.min(dstW, Math.round(curW * stepFactor));
    const nextH = Math.min(dstH, Math.round(curH * stepFactor));
    const next = document.createElement("canvas");
    next.width = nextW;
    next.height = nextH;
    const ctx = next.getContext("2d");
    if (!ctx) throw new Error("Canvas processing is unavailable");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(current, 0, 0, nextW, nextH);
    current = next;
    curW = nextW;
    curH = nextH;
  }
  return current;
}

/** Light unsharp-mask style pass to restore perceived sharpness after scaling. */
function sharpen(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas processing is unavailable");
  ctx.filter = "contrast(1.05) saturate(1.04)";
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = "none";
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.18;
  ctx.drawImage(canvas, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  return out;
}

async function upscalePhoto(
  file: File,
  resolution: keyof typeof HEIGHTS,
  onProgress?: LocalProgress,
): Promise<LocalMediaResult> {
  const bitmap = await createImageBitmap(file);
  try {
    onProgress?.(0.15);
    const size = outputSize(bitmap.width, bitmap.height, resolution);
    const scaled = stepScale(bitmap, bitmap.width, bitmap.height, size.width, size.height);
    onProgress?.(0.7);
    const finalCanvas = sharpen(scaled);
    onProgress?.(0.9);
    // Lossless PNG export; quality argument kept at 1.0 for encoders that honour it.
    const blob = await canvasBlob(finalCanvas, "image/png", 1.0);
    onProgress?.(1);
    return { blob, extension: "png", contentType: "image/png" };
  } finally {
    bitmap.close();
  }
}

type VideoFrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
};

type FrameRequestTrack = MediaStreamTrack & { requestFrame?: () => void };

const TARGET_FPS = 60;

/** Seek the video to an exact timestamp and wait until that frame is decoded. */
function seekTo(video: VideoFrameCallbackVideo, time: number) {
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    const onSeeked = () => {
      if (typeof video.requestVideoFrameCallback === "function") {
        video.requestVideoFrameCallback(() => done());
      } else {
        requestAnimationFrame(() => done());
      }
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.onerror = () => reject(new Error("The selected video could not be decoded"));
    try {
      video.currentTime = Math.min(time, Math.max(0, video.duration - 0.0001));
    } catch (error) {
      reject(error instanceof Error ? error : new Error("Video seek failed"));
    }
  });
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function upscaleVideo(
  file: File,
  resolution: keyof typeof HEIGHTS,
  onProgress?: LocalProgress,
): Promise<LocalMediaResult> {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    throw new Error("This browser does not support local video processing");
  }

  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement("video") as VideoFrameCallbackVideo;
  video.src = sourceUrl;
  video.playsInline = true;
  video.preload = "auto";
  video.muted = true;
  video.volume = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("The selected video could not be decoded"));
    });
    // Make sure the first frame is actually decoded before capture starts.
    await seekTo(video, 0);

    const size = outputSize(video.videoWidth, video.videoHeight, resolution);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas processing is unavailable");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Manual-frame capture: the recorder only advances when we push a frame,
    // so a slow device stretches the work instead of dropping frames.
    const canvasStream = canvas.captureStream(0);
    const videoTrack = canvasStream.getVideoTracks()[0] as FrameRequestTrack;
    const stream = new MediaStream([videoTrack]);

    const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "video/webm";
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 16_000_000,
    });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    const finished = new Promise<Blob>((resolve, reject) => {
      recorder.onerror = () => reject(new Error("Local video encoder failed"));
      recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
    });

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration <= 0) throw new Error("The selected video has no readable duration");
    const totalFrames = Math.max(1, Math.round(duration * TARGET_FPS));

    // Decode the original audio up-front (independent of the slow frame pass).
    const audioBuffer = await decodeSourceAudio(file);

    recorder.start();

    for (let frame = 0; frame < totalFrames; frame++) {
      const time = (frame / TARGET_FPS) * 1;
      // Duplicate source frames evenly: seeking to each 1/60s slot yields the
      // nearest decoded frame, so slower sources become native 60 FPS output.
      await seekTo(video, Math.min(time, duration));

      const scaled = stepScale(video, video.videoWidth, video.videoHeight, size.width, size.height);
      const sharpened = sharpen(scaled);
      ctx.drawImage(sharpened, 0, 0, size.width, size.height);

      videoTrack.requestFrame?.();
      // Yield to the encoder so nothing is queued or coalesced away.
      await nextTask();
      const fraction = (frame + 1) / totalFrames;
      onProgress?.(Math.min(0.85, fraction * (audioBuffer ? 0.85 : 0.99)));
    }

    // Let the encoder flush the last pushed frame before stopping.
    await new Promise((resolve) => setTimeout(resolve, 300));
    recorder.stop();
    stream.getTracks().forEach((track) => track.stop());

    const silentBlob = await finished;
    if (!audioBuffer) {
      onProgress?.(1);
      return { blob: silentBlob, extension: "webm", contentType: "video/webm" };
    }

    const merged = await muxAudio(silentBlob, audioBuffer, duration, mimeType, (fraction) =>
      onProgress?.(0.85 + fraction * 0.14),
    );
    onProgress?.(1);
    return { blob: merged, extension: "webm", contentType: "video/webm" };
  } finally {
    video.pause();
    URL.revokeObjectURL(sourceUrl);
  }
}

type AudioCtor = typeof AudioContext;

function getAudioContextCtor(): AudioCtor | null {
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Decode the source file's audio track; returns null when the file has none. */
async function decodeSourceAudio(file: File): Promise<AudioBuffer | null> {
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;
  const ctx = new Ctor();
  try {
    const bytes = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(bytes);
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  } finally {
    void ctx.close();
  }
}

/**
 * Second pass: play the rendered (silent) video in real time while feeding the
 * decoded original audio through a MediaStream destination, so both tracks are
 * recorded on the same clock and stay in sync for the full source duration.
 */
async function muxAudio(
  silentVideo: Blob,
  audioBuffer: AudioBuffer,
  duration: number,
  mimeType: string,
  onProgress?: LocalProgress,
): Promise<Blob> {
  const Ctor = getAudioContextCtor();
  if (!Ctor) return silentVideo;

  const url = URL.createObjectURL(silentVideo);
  const player = document.createElement("video");
  player.src = url;
  player.muted = true;
  player.playsInline = true;
  player.preload = "auto";
  const audioCtx = new Ctor();

  try {
    await new Promise<void>((resolve, reject) => {
      player.oncanplaythrough = () => resolve();
      player.onerror = () => reject(new Error("Rendered video could not be re-read for audio merge"));
    });

    const videoStream = (
      player as HTMLVideoElement & { captureStream?: () => MediaStream }
    ).captureStream?.();
    const videoTrack = videoStream?.getVideoTracks()[0];
    if (!videoTrack) return silentVideo;

    const destination = audioCtx.createMediaStreamDestination();
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(destination);
    const audioTrack = destination.stream.getAudioTracks()[0];
    if (!audioTrack) return silentVideo;

    const combined = new MediaStream([videoTrack, audioTrack]);
    const recorder = new MediaRecorder(combined, {
      mimeType,
      videoBitsPerSecond: 16_000_000,
      audioBitsPerSecond: 192_000,
    });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    const finished = new Promise<Blob>((resolve, reject) => {
      recorder.onerror = () => reject(new Error("Audio merge encoder failed"));
      recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
    });

    await audioCtx.resume();
    recorder.start();
    // Start both clocks together so audio never drifts from the picture.
    source.start();
    await player.play();

    await new Promise<void>((resolve) => {
      const tick = setInterval(() => {
        onProgress?.(Math.min(0.99, duration > 0 ? player.currentTime / duration : 0));
      }, 200);
      const done = () => {
        clearInterval(tick);
        resolve();
      };
      player.onended = done;
      // Safety net in case 'ended' never fires on a stream-backed element.
      setTimeout(done, Math.ceil((duration + 2) * 1000));
    });

    // Flush the tail before finalising.
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (recorder.state !== "inactive") recorder.stop();
    try {
      source.stop();
    } catch {
      /* already stopped */
    }
    combined.getTracks().forEach((track) => track.stop());

    const blob = await finished;
    onProgress?.(1);
    return blob.size > 0 ? blob : silentVideo;
  } catch {
    return silentVideo;
  } finally {
    player.pause();
    URL.revokeObjectURL(url);
    void audioCtx.close();
  }
}




export function processMediaLocally(
  file: File,
  kind: "photo" | "video",
  resolution: keyof typeof HEIGHTS,
  onProgress?: LocalProgress,
) {
  return kind === "photo"
    ? upscalePhoto(file, resolution, onProgress)
    : upscaleVideo(file, resolution, onProgress);
}

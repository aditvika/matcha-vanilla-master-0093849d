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
    const nextW = Math.min(dstW, Math.round(curW * 2));
    const nextH = Math.min(dstH, Math.round(curH * 2));
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
    const blob = await canvasBlob(finalCanvas, "image/png");
    onProgress?.(1);
    return { blob, extension: "png", contentType: "image/png" };
  } finally {
    bitmap.close();
  }
}

async function upscaleVideo(
  file: File,
  resolution: keyof typeof HEIGHTS,
  onProgress?: LocalProgress,
): Promise<LocalMediaResult> {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    throw new Error("This browser does not support local video processing");
  }

  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = sourceUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("The selected video could not be decoded"));
    });

    const size = outputSize(video.videoWidth, video.videoHeight, resolution);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas processing is unavailable");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Intermediate buffer at 2x source used for step-scaling each frame.
    const midW = Math.min(size.width, video.videoWidth * 2);
    const midH = Math.min(size.height, video.videoHeight * 2);
    const mid = document.createElement("canvas");
    mid.width = Math.max(1, Math.round(midW));
    mid.height = Math.max(1, Math.round(midH));
    const midCtx = mid.getContext("2d");
    if (!midCtx) throw new Error("Canvas processing is unavailable");
    midCtx.imageSmoothingEnabled = true;
    midCtx.imageSmoothingQuality = "high";

    const stream = canvas.captureStream(30);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    const finished = new Promise<Blob>((resolve, reject) => {
      recorder.onerror = () => reject(new Error("Local video encoder failed"));
      recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
    });

    let drawing = true;
    const draw = () => {
      if (!drawing) return;
      // Frame-level upscale: source -> 2x buffer -> target, then sharpen pass.
      midCtx.drawImage(video, 0, 0, mid.width, mid.height);
      ctx.filter = "none";
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.drawImage(mid, 0, 0, size.width, size.height);
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = 0.16;
      ctx.drawImage(mid, 0, 0, size.width, size.height);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      if (onProgress && video.duration > 0) {
        onProgress(Math.min(0.99, video.currentTime / video.duration));
      }
      requestAnimationFrame(draw);
    };

    recorder.start(1000);
    draw();
    await video.play();
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("Local video processing timed out")),
        Math.max(30_000, video.duration * 1_000 + 30_000),
      );
      video.onended = () => {
        window.clearTimeout(timeout);
        resolve();
      };
    });
    drawing = false;
    recorder.stop();
    stream.getTracks().forEach((track) => track.stop());

    const blob = await finished;
    onProgress?.(1);
    return { blob, extension: "webm", contentType: "video/webm" };
  } finally {
    video.pause();
    URL.revokeObjectURL(sourceUrl);
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

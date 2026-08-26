export type LocalMediaResult = {
  blob: Blob;
  extension: "png" | "webm";
  contentType: "image/png" | "video/webm";
};

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

async function upscalePhoto(file: File, resolution: keyof typeof HEIGHTS): Promise<LocalMediaResult> {
  const bitmap = await createImageBitmap(file);
  try {
    const size = outputSize(bitmap.width, bitmap.height, resolution);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas processing is unavailable");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.filter = "contrast(1.04) saturate(1.03) sharpen(1)";
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    return {
      blob: await canvasBlob(canvas, "image/png"),
      extension: "png",
      contentType: "image/png",
    };
  } finally {
    bitmap.close();
  }
}

async function upscaleVideo(file: File, resolution: keyof typeof HEIGHTS): Promise<LocalMediaResult> {
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
    ctx.filter = "contrast(1.04) saturate(1.03)";

    const stream = canvas.captureStream(30);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
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
      ctx.drawImage(video, 0, 0, size.width, size.height);
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

    return { blob: await finished, extension: "webm", contentType: "video/webm" };
  } finally {
    video.pause();
    URL.revokeObjectURL(sourceUrl);
  }
}

export function processMediaLocally(
  file: File,
  kind: "photo" | "video",
  resolution: keyof typeof HEIGHTS,
) {
  return kind === "photo" ? upscalePhoto(file, resolution) : upscaleVideo(file, resolution);
}
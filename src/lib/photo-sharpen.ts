/**
 * Final polish pass for enhanced photos.
 *
 * The storage renderer gives us a clean, correctly-sized image, but no
 * sharpening. This applies an unsharp-mask style convolution plus a mild
 * contrast/saturation lift so the result reads as clearly crisper than the
 * original when placed side by side.
 */

const SHARPEN_KERNEL = [0, -0.65, 0, -0.65, 3.6, -0.65, 0, -0.65, 0];
const CONTRAST = 1.1;
const SATURATION = 1.06;

function applyContrast(data: Uint8ClampedArray) {
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = data[i + c]!;
      data[i + c] = Math.max(0, Math.min(255, (v - 128) * CONTRAST + 128));
    }
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    data[i] = Math.max(0, Math.min(255, gray + (r - gray) * SATURATION));
    data[i + 1] = Math.max(0, Math.min(255, gray + (g - gray) * SATURATION));
    data[i + 2] = Math.max(0, Math.min(255, gray + (b - gray) * SATURATION));
  }
}

function convolve(src: ImageData, out: ImageData) {
  const { width: w, height: h, data: s } = src;
  const d = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let k = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const px = Math.min(w - 1, Math.max(0, x + kx));
            const py = Math.min(h - 1, Math.max(0, y + ky));
            sum += s[(py * w + px) * 4 + c]! * SHARPEN_KERNEL[k]!;
            k++;
          }
        }
        d[o + c] = Math.max(0, Math.min(255, sum));
      }
      d[o + 3] = s[o + 3]!;
    }
  }
}

/** Returns a sharpened JPEG/PNG blob; falls back to the input on any failure. */
export async function sharpenPhotoBlob(blob: Blob, contentType: string): Promise<Blob> {
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return blob;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();

    const src = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const out = ctx.createImageData(canvas.width, canvas.height);
    convolve(src, out);
    applyContrast(out.data);
    ctx.putImageData(out, 0, 0);

    const type = contentType.includes("png") ? "image/png" : "image/jpeg";
    const result = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, type === "image/jpeg" ? 0.97 : undefined),
    );
    if (!result || result.size < 1024) return blob;
    return result;
  } catch (error) {
    console.warn("[photo-sharpen] skipped", error);
    return blob;
  }
}

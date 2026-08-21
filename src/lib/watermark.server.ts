/**
 * Watermark removal engines (fal.ai).
 *
 * Images  -> fal-ai/bria/eraser (mask based). For text / auto modes the mask is
 *            derived first with fal-ai/evf-sam text-prompted segmentation.
 * Videos  -> fal-ai/bria/video/erase/prompt (text prompt based removal).
 *
 * Server-only module: never import from client code.
 */

export type WatermarkMode = "text" | "auto" | "area";

export class WatermarkError extends Error {
  constructor(
    message: string,
    readonly reason: "RATE_LIMIT" | "TIMEOUT" | "MISSING_KEY" | "FAILED",
  ) {
    super(message);
    this.name = "WatermarkError";
  }
}

async function falFetch(model: string, body: unknown, ms: number): Promise<Record<string, unknown>> {
  const key = process.env["FAL_KEY"];
  if (!key) throw new WatermarkError("FAL_KEY missing", "MISSING_KEY");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  let res: Response;
  try {
    res = await fetch(`https://fal.run/${model}`, {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new WatermarkError("Engine timed out", "TIMEOUT");
    }
    throw new WatermarkError(String(err), "FAILED");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) throw new WatermarkError("Rate limited", "RATE_LIMIT");
  if (!res.ok) throw new WatermarkError(`fal ${res.status}`, "FAILED");
  return (await res.json()) as Record<string, unknown>;
}

function pickUrl(json: Record<string, unknown>): string | null {
  const direct =
    (json["image"] as { url?: string } | undefined)?.url ??
    (json["video"] as { url?: string } | undefined)?.url ??
    (json["mask"] as { url?: string } | undefined)?.url ??
    (json["mask_image"] as { url?: string } | undefined)?.url ??
    null;
  if (direct) return direct;
  const images = json["images"];
  if (Array.isArray(images)) return (images[0] as { url?: string } | undefined)?.url ?? null;
  return null;
}

function promptFor(mode: WatermarkMode, text: string | undefined): string {
  if (mode === "text" && text) return `watermark text "${text}"`;
  return "watermark, logo overlay, text overlay";
}

/** Derive a mask for the watermark from a text prompt. */
async function maskFromPrompt(imageUrl: string, prompt: string): Promise<string> {
  const json = await falFetch("fal-ai/evf-sam", { image_url: imageUrl, prompt }, 90_000);
  const url = pickUrl(json);
  if (!url) throw new WatermarkError("No mask produced", "FAILED");
  return url;
}

export async function removeImageWatermark(
  sourceUrl: string,
  mode: WatermarkMode,
  opts: { text?: string; maskUrl?: string },
): Promise<string> {
  const maskUrl =
    mode === "area" && opts.maskUrl
      ? opts.maskUrl
      : await maskFromPrompt(sourceUrl, promptFor(mode, opts.text));

  const json = await falFetch(
    "fal-ai/bria/eraser",
    { image_url: sourceUrl, mask_url: maskUrl },
    120_000,
  );
  const url = pickUrl(json);
  if (!url) throw new WatermarkError("No image produced", "FAILED");
  return url;
}

export async function removeVideoWatermark(
  sourceUrl: string,
  mode: WatermarkMode,
  opts: { text?: string; maskUrl?: string },
): Promise<string> {
  if (mode === "area" && opts.maskUrl) {
    const json = await falFetch(
      "fal-ai/bria/video/erase/mask",
      { video_url: sourceUrl, mask_url: opts.maskUrl },
      300_000,
    );
    const url = pickUrl(json);
    if (url) return url;
  }

  const json = await falFetch(
    "fal-ai/bria/video/erase/prompt",
    { video_url: sourceUrl, prompt: promptFor(mode, opts.text) },
    300_000,
  );
  const url = pickUrl(json);
  if (!url) throw new WatermarkError("No video produced", "FAILED");
  return url;
}

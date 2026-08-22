/**
 * Dual-pipeline media engines.
 *
 * FREE tier  -> Hugging Face Inference API (Real-ESRGAN) for photos.
 *               Video 720p is handled by the lightweight client-side path,
 *               never by Fal.ai.
 * PAID tier  -> Fal.ai models, keyed by media kind + resolution.
 *
 * Nothing in this module may be imported from client code (`.server.ts`).
 */

export type MediaKind = "photo" | "video";
export type Resolution = "720p" | "1080p" | "2K" | "4K";

export class EngineError extends Error {
  constructor(
    message: string,
    readonly reason: "RATE_LIMIT" | "TIMEOUT" | "MISSING_KEY" | "FAILED",
  ) {
    super(message);
    this.name = "EngineError";
  }
}

/** Fal.ai model routing — VIP only. */
export function falModelFor(kind: MediaKind, resolution: Resolution): string {
  if (kind === "photo") {
    return resolution === "720p" || resolution === "1080p"
      ? "fal-ai/codeformer"
      : "fal-ai/aura-sr";
  }
  return resolution === "720p" || resolution === "1080p"
    ? "fal-ai/bytedance-upscaler/upscale/video"
    : "fal-ai/seedvr/upscale/video";
}

const HF_MODEL = "ai-forever/Real-ESRGAN";

async function withTimeout(input: string, init: RequestInit, ms: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new EngineError("Engine timed out", "TIMEOUT");
    }
    throw new EngineError(String(err), "FAILED");
  } finally {
    clearTimeout(timer);
  }
}

/** FREE photo engine: Hugging Face Real-ESRGAN. Returns raw image bytes. */
export async function runFreePhotoEngine(sourceUrl: string): Promise<ArrayBuffer> {
  const token = process.env["HF_TOKEN"] ?? process.env["HUGGINGFACE_TOKEN"];
  if (!token) throw new EngineError("HF_TOKEN missing", "MISSING_KEY");


  const src = await withTimeout(sourceUrl, { method: "GET" }, 30_000);
  if (!src.ok) throw new EngineError("Could not read source media", "FAILED");
  const bytes = await src.arrayBuffer();

  const res = await withTimeout(
    `https://api-inference.huggingface.co/models/${HF_MODEL}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
      },
      body: bytes,
    },
    55_000,
  );

  if (res.status === 429 || res.status === 503) {
    throw new EngineError("Free engine is busy", "RATE_LIMIT");
  }
  if (!res.ok) throw new EngineError(`HF ${res.status}`, "FAILED");
  return res.arrayBuffer();
}

/** PAID engine: Fal.ai. Returns the URL of the produced media. */
export async function runFalEngine(
  kind: MediaKind,
  resolution: Resolution,
  sourceUrl: string,
): Promise<string> {
  const key = process.env["FAL_KEY"];
  if (!key) throw new EngineError("FAL_KEY missing", "MISSING_KEY");

  const model = falModelFor(kind, resolution);
  const body =
    kind === "photo"
      ? { image_url: sourceUrl }
      : { video_url: sourceUrl };

  const res = await withTimeout(
    `https://fal.run/${model}`,
    {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    kind === "photo" ? 90_000 : 240_000,
  );

  if (res.status === 429) throw new EngineError("Fal.ai rate limited", "RATE_LIMIT");
  if (!res.ok) throw new EngineError(`Fal.ai ${res.status}`, "FAILED");

  const json = (await res.json()) as Record<string, unknown>;
  const url =
    (json["video"] as { url?: string } | undefined)?.url ??
    (json["image"] as { url?: string } | undefined)?.url ??
    (Array.isArray(json["images"])
      ? ((json["images"] as { url?: string }[])[0]?.url ?? null)
      : null);

  if (!url) throw new EngineError("Fal.ai returned no media", "FAILED");
  return url;
}

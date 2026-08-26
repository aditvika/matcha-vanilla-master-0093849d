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
    readonly reason: "RATE_LIMIT" | "TIMEOUT" | "MISSING_KEY" | "BAD_KEY" | "FAILED",
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

/** Candidate HF image-upscaling endpoints, tried in order. */
const HF_ENDPOINTS = [
  "https://router.huggingface.co/hf-inference/models/ai-forever/Real-ESRGAN",
  "https://router.huggingface.co/hf-inference/models/xinntao/ESRGAN",
  "https://api-inference.huggingface.co/models/ai-forever/Real-ESRGAN",
  "https://api-inference.huggingface.co/models/xinntao/ESRGAN",
];

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

function bytesFromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/**
 * Hugging Face attempt. Tries the Router endpoint first, then the classic
 * model endpoints. Retries while a model is cold-starting (503).
 */
async function tryHuggingFace(bytes: ArrayBuffer, contentType: string): Promise<ArrayBuffer> {
  const token = process.env["HF_TOKEN"] ?? process.env["HUGGINGFACE_TOKEN"];
  if (!token) throw new EngineError("HF_TOKEN missing", "MISSING_KEY");

  let lastError: EngineError = new EngineError("HF unavailable", "FAILED");

  for (const endpoint of HF_ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await withTimeout(
        endpoint,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": contentType || "application/octet-stream",
            Accept: "image/png",
            "x-wait-for-model": "true",
          },
          body: bytes,
        },
        120_000,
      );

      if (res.ok) {
        const type = res.headers.get("content-type") ?? "";
        if (type.startsWith("image/")) return await res.arrayBuffer();
        // Some deployments answer with JSON containing a base64 image.
        const text = await res.text();
        try {
          const json = JSON.parse(text) as Record<string, unknown>;
          const b64 = (json["image"] as string) ?? (json["generated_image"] as string);
          if (typeof b64 === "string") return bytesFromBase64(b64.replace(/^data:[^,]+,/, ""));
        } catch {
          /* fall through */
        }
        lastError = new EngineError(`HF unexpected response: ${text.slice(0, 200)}`, "FAILED");
        break;
      }

      const detail = await res.text().catch(() => "");
      console.error(`[hf] ${endpoint} -> ${res.status} ${detail.slice(0, 500)}`);

      if (res.status === 503) {
        // Model is loading — honour estimated_time, then retry.
        let waitMs = 12_000;
        try {
          const est = (JSON.parse(detail) as { estimated_time?: number }).estimated_time;
          if (typeof est === "number") waitMs = Math.min(45_000, Math.ceil(est * 1000) + 2_000);
        } catch {
          /* default wait */
        }
        lastError = new EngineError("HF model is loading", "RATE_LIMIT");
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        lastError = new EngineError(`HF ${res.status}: invalid or unauthorized HF_TOKEN`, "BAD_KEY");
        break;
      }
      if (res.status === 429) {
        lastError = new EngineError("HF rate limited", "RATE_LIMIT");
        break;
      }
      lastError = new EngineError(`HF ${res.status}: ${detail.slice(0, 200)}`, "FAILED");
      break;
    }
    // A bad key will fail on every endpoint — stop early.
    if (lastError.reason === "BAD_KEY") break;
  }

  throw lastError;
}

/**
 * FREE photo engine. Hugging Face failures retain their exact cause so the
 * caller can switch to the browser's canvas upscaler without charging first.
 */
export async function runFreePhotoEngine(sourceUrl: string): Promise<ArrayBuffer> {
  const src = await withTimeout(sourceUrl, { method: "GET" }, 60_000);
  if (!src.ok) throw new EngineError("Could not read source media", "FAILED");
  const contentType = src.headers.get("content-type") ?? "image/jpeg";
  const bytes = await src.arrayBuffer();

  return await tryHuggingFace(bytes, contentType);
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

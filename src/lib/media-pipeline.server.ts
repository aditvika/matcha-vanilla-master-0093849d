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
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GATEWAY_MODEL = "google/gemini-2.5-flash-image";

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

function base64FromBytes(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    bin += String.fromCharCode(...arr.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function bytesFromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Hugging Face attempt. Retries while the model is cold-starting (503). */
async function tryHuggingFace(bytes: ArrayBuffer, contentType: string): Promise<ArrayBuffer> {
  const token = process.env["HF_TOKEN"] ?? process.env["HUGGINGFACE_TOKEN"];
  if (!token) throw new EngineError("HF_TOKEN missing", "MISSING_KEY");

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await withTimeout(
      HF_ENDPOINT,
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
      throw new EngineError(`HF unexpected response: ${text.slice(0, 300)}`, "FAILED");
    }

    const detail = await res.text().catch(() => "");
    console.error(`[hf] ${res.status} ${detail.slice(0, 500)}`);

    if (res.status === 503) {
      // Model is loading — honour estimated_time, then retry.
      let waitMs = 12_000;
      try {
        const est = (JSON.parse(detail) as { estimated_time?: number }).estimated_time;
        if (typeof est === "number") waitMs = Math.min(45_000, Math.ceil(est * 1000) + 2_000);
      } catch {
        /* default wait */
      }
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (res.status === 429) throw new EngineError("Free engine is busy", "RATE_LIMIT");
    throw new EngineError(`HF ${res.status}: ${detail.slice(0, 300)}`, "FAILED");
  }
  throw new EngineError("HF model still loading after retries", "RATE_LIMIT");
}

/** Fallback free engine: Lovable AI Gateway image model (no user key required). */
async function tryGateway(bytes: ArrayBuffer, contentType: string): Promise<ArrayBuffer> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new EngineError("LOVABLE_API_KEY missing", "MISSING_KEY");

  const dataUri = `data:${contentType || "image/jpeg"};base64,${base64FromBytes(bytes)}`;
  const res = await withTimeout(
    GATEWAY_URL,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GATEWAY_MODEL,
        modalities: ["image", "text"],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Upscale and restore this photo: sharpen details, remove noise and compression artifacts, keep the exact same composition, faces and colors. Return only the enhanced image.",
              },
              { type: "image_url", image_url: { url: dataUri } },
            ],
          },
        ],
      }),
    },
    120_000,
  );

  if (res.status === 429) throw new EngineError("Free engine is busy", "RATE_LIMIT");
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[gateway] ${res.status} ${detail.slice(0, 500)}`);
    throw new EngineError(`Gateway ${res.status}: ${detail.slice(0, 300)}`, "FAILED");
  }

  const json = (await res.json()) as {
    choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
  };
  const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new EngineError("Gateway returned no image", "FAILED");
  return bytesFromBase64(url.replace(/^data:[^,]+,/, ""));
}

/**
 * FREE photo engine. Tries Hugging Face first (Real-ESRGAN); if the token is
 * missing/invalid or the model is unavailable, falls back to the built-in AI
 * image model so free users still get a result.
 */
export async function runFreePhotoEngine(sourceUrl: string): Promise<ArrayBuffer> {
  const src = await withTimeout(sourceUrl, { method: "GET" }, 60_000);
  if (!src.ok) throw new EngineError("Could not read source media", "FAILED");
  const contentType = src.headers.get("content-type") ?? "image/jpeg";
  const bytes = await src.arrayBuffer();

  try {
    return await tryHuggingFace(bytes, contentType);
  } catch (err) {
    console.error("[free-photo] Hugging Face failed, falling back:", err);
    return await tryGateway(bytes, contentType);
  }
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

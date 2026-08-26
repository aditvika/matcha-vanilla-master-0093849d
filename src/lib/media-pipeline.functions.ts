import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  path: z.string().min(1),
  kind: z.enum(["photo", "video"]),
  resolution: z.enum(["720p", "1080p", "2K", "4K"]),
});

export type ProcessMediaResult =
  | {
      ok: true;
      outputUrl: string;
      engine: "huggingface" | "fal" | "client";
      tier: string;
      charged: number;
    }
  | {
      ok: false;
      reason: "LOCAL_FALLBACK";
      message: string;
    }
  | {
      ok: false;
      reason:
        | "RATE_LIMIT"
        | "TIMEOUT"
        | "MISSING_KEY"
        | "BAD_KEY"
        | "FAILED"
        | "LOCKED"
        | "INSUFFICIENT_CREDITS";
      message?: string;
    };

/**
 * Single entry point for both pipelines. Credits are NEVER deducted up-front:
 * we only check affordability, run the engine, and charge after a successful
 * result. A failed engine call therefore leaves the balance untouched.
 */
export const processMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ProcessMediaResult> => {
    const { supabase, userId } = context;
    const { path, kind, resolution } = data;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = supabase.rpc as any;

    // ---- STEP 1: check only, no deduction ----
    const { data: status } = await rpc("get_credit_status");
    const s = (status ?? {}) as {
      tier?: string;
      pools?: { key: string; limit: number; used: number; remaining: number }[];
      rates?: { kind: string; resolution: string; locked: boolean; cost: number | null }[];
    };
    const tier = String(s.tier ?? "free");
    const isPaid = tier !== "free";

    const rate = (s.rates ?? []).find((r) => r.kind === kind && r.resolution === resolution);
    if (!rate || rate.locked || rate.cost === null) {
      return { ok: false, reason: "LOCKED" };
    }
    const poolKey = isPaid ? "credits" : kind;
    const pool = (s.pools ?? []).find((p) => p.key === poolKey);
    if (pool && pool.remaining < rate.cost) {
      return { ok: false, reason: "INSUFFICIENT_CREDITS" };
    }

    const { data: signed, error: signErr } = await supabase.storage
      .from("mv-media")
      .createSignedUrl(path, 60 * 30);

    if (signErr || !signed?.signedUrl) {
      return { ok: false, reason: "FAILED" };
    }
    const sourceUrl = signed.signedUrl;

    const {
      EngineError,
      runFalEngine,
      runFreePhotoEngine,
    } = await import("./media-pipeline.server");

    // ---- STEP 2: run the engine ----
    let outputUrl: string;
    let engine: "huggingface" | "fal" | "client";
    try {
      if (!isPaid) {
        if (kind === "video") {
          // Lightweight client-side path; no server-side transcode.
          return {
            ok: false,
            reason: "LOCAL_FALLBACK",
            message: "Free video enhancement uses the on-device frame processor.",
          };
        } else {
          let bytes: ArrayBuffer;
          try {
            bytes = await runFreePhotoEngine(sourceUrl);
          } catch (err) {
            const message = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
            console.error("[media-pipeline] HF photo failed; requesting local fallback:", message);
            return { ok: false, reason: "LOCAL_FALLBACK", message };
          }
          const outPath = `${userId}/out-${Date.now()}.png`;
          const { error: upErr } = await supabase.storage
            .from("mv-media")
            .upload(outPath, bytes, { contentType: "image/png", upsert: true });
          if (upErr) throw new EngineError(upErr.message, "FAILED");
          const { data: outSigned } = await supabase.storage
            .from("mv-media")
            .createSignedUrl(outPath, 60 * 60);
          if (!outSigned?.signedUrl) throw new EngineError("No signed output URL", "FAILED");
          outputUrl = outSigned.signedUrl;
          engine = "huggingface";
        }
      } else {
        outputUrl = await runFalEngine(kind, resolution, sourceUrl);
        engine = "fal";
      }
    } catch (err) {
      const reason = err instanceof EngineError ? err.reason : ("FAILED" as const);
      const message = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
      console.error("[media-pipeline]", tier, kind, resolution, reason, message);
      // STEP 3A: nothing was ever charged, so nothing to refund.
      return { ok: false, reason, message };
    }

    // ---- STEP 3B: success -> charge now ----
    const { data: charge } = await rpc("consume_credits", {
      p_kind: kind,
      p_resolution: resolution,
    });
    const c = (charge ?? {}) as { success?: boolean; cost?: number };
    if (!c.success) return { ok: false, reason: "INSUFFICIENT_CREDITS" };

    return { ok: true, outputUrl, engine, tier, charged: Number(c.cost ?? 0) };
  });

export const completeLocalMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      outputPath: z.string().min(1),
      kind: z.enum(["photo", "video"]),
      resolution: z.enum(["720p", "1080p", "2K", "4K"]),
    }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ProcessMediaResult> => {
    const { supabase, userId } = context;
    if (!data.outputPath.startsWith(`${userId}/out-local-`)) {
      return { ok: false, reason: "FAILED", message: "Invalid local output path" };
    }

    const fileName = data.outputPath.split("/").pop();
    if (!fileName) return { ok: false, reason: "FAILED", message: "Invalid local output" };
    const { data: files, error: listError } = await supabase.storage
      .from("mv-media")
      .list(userId, { search: fileName, limit: 1 });
    if (listError || !files?.some((file) => file.name === fileName)) {
      return { ok: false, reason: "FAILED", message: "Processed output was not found" };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: charge } = await (supabase.rpc as any)("consume_credits", {
      p_kind: data.kind,
      p_resolution: data.resolution,
    });
    const result = (charge ?? {}) as { success?: boolean; cost?: number };
    if (!result.success) return { ok: false, reason: "INSUFFICIENT_CREDITS" };

    const { data: signed, error: signError } = await supabase.storage
      .from("mv-media")
      .createSignedUrl(data.outputPath, 60 * 60);
    if (signError || !signed?.signedUrl) {
      console.error("[media-pipeline] local output signing failed after charge:", signError?.message);
      return { ok: false, reason: "FAILED", message: "Could not open processed output" };
    }

    return {
      ok: true,
      outputUrl: signed.signedUrl,
      engine: "client",
      tier: "free",
      charged: Number(result.cost ?? 0),
    };
  });


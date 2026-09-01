import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ProcessMediaResult =
  | {
      ok: true;
      outputUrl: string;
      engine: "fal" | "client";
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
  .inputValidator((input: unknown) =>
    z.object({
      path: z.string().min(1),
      kind: z.enum(["photo", "video"]),
      resolution: z.enum(["720p", "1080p", "2K", "4K"]),
    }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ProcessMediaResult> => {
    try {
      const { supabase, userId } = context;
      void userId;
      const { path, kind, resolution } = data;

      // Bound wrapper: never detach `rpc` from the Supabase client.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rpc = (fn: string, args?: unknown) => (supabase.rpc as any)(fn, args);

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

      // ---- FREE TIER: no external API. Local browser engine handles it. ----
      if (!isPaid) {
        return {
          ok: false,
          reason: "LOCAL_FALLBACK",
          message: "Free tier uses the on-device canvas engine.",
        };
      }

      const { data: signed, error: signErr } = await supabase.storage
        .from("mv-media")
        .createSignedUrl(path, 60 * 30);

      if (signErr || !signed?.signedUrl) {
        return { ok: false, reason: "FAILED" };
      }
      const sourceUrl = signed.signedUrl;

      const { EngineError, runFalEngine } = await import("./media-pipeline.server");

      // ---- STEP 2: run the paid engine (Fal.ai) ----
      let outputUrl: string;
      try {
        outputUrl = await runFalEngine(kind, resolution, sourceUrl);
      } catch (err) {
        const reason = err instanceof EngineError ? err.reason : ("FAILED" as const);
        const message =
          err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
        console.error("[media-pipeline]", tier, kind, resolution, reason, message);
        // Nothing was ever charged, so nothing to refund.
        return { ok: false, reason, message };
      }

      // ---- STEP 3: success -> charge now ----
      const { data: charge } = await rpc("consume_credits", {
        p_kind: kind,
        p_resolution: resolution,
      });
      const c = (charge ?? {}) as { success?: boolean; cost?: number };
      if (!c.success) return { ok: false, reason: "INSUFFICIENT_CREDITS" };

      return { ok: true, outputUrl, engine: "fal", tier, charged: Number(c.cost ?? 0) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[media-pipeline] unhandled", message);
      return { ok: false, reason: "FAILED", message };
    }
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
    try {
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

      const { data: signed, error: signError } = await supabase.storage
        .from("mv-media")
        .createSignedUrl(data.outputPath, 60 * 60);
      if (signError || !signed?.signedUrl) {
        console.error("[media-pipeline] local output signing failed:", signError?.message);
        return { ok: false, reason: "FAILED", message: "Could not open processed output" };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rpc = (fn: string, args?: unknown) => (supabase.rpc as any)(fn, args);
      const { data: charge } = await rpc("consume_credits", {
        p_kind: data.kind,
        p_resolution: data.resolution,
      });
      const result = (charge ?? {}) as { success?: boolean; cost?: number };
      if (!result.success) return { ok: false, reason: "INSUFFICIENT_CREDITS" };

      return {
        ok: true,
        outputUrl: signed.signedUrl,
        engine: "client",
        tier: "free",
        charged: Number(result.cost ?? 0),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[media-pipeline] completeLocalMedia unhandled", message);
      return { ok: false, reason: "FAILED", message };
    }
  });



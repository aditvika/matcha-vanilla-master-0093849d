import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  path: z.string().min(1),
  kind: z.enum(["photo", "video"]),
  resolution: z.enum(["720p", "1080p", "2K", "4K"]),
});

export type ProcessMediaResult =
  | { ok: true; outputUrl: string; engine: "huggingface" | "fal" | "client"; tier: string }
  | {
      ok: false;
      reason: "RATE_LIMIT" | "TIMEOUT" | "MISSING_KEY" | "FAILED" | "LOCKED";
      refunded: boolean;
    };

/**
 * Single entry point for both pipelines. The tier is resolved server-side, so a
 * free account can never reach Fal.ai and a VIP account never hits the free
 * engine. Any engine failure on a paid job refunds the deducted credits.
 */
export const processMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ProcessMediaResult> => {
    const { supabase, userId } = context;
    const { path, kind, resolution } = data;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = supabase.rpc as any;

    const refund = async () => {
      const { data: r } = await rpc("refund_credits", {
        p_kind: kind,
        p_resolution: resolution,
      });
      return Boolean((r as { success?: boolean } | null)?.success);
    };

    const { data: status } = await rpc("get_credit_status");
    const tier = String((status as { tier?: string } | null)?.tier ?? "free");
    const isPaid = tier !== "free";

    // Free tier can never request premium-only resolutions.
    if (!isPaid) {
      const photoAllowed = kind === "photo" && (resolution === "720p" || resolution === "1080p");
      const videoAllowed = kind === "video" && resolution === "720p";
      if (!photoAllowed && !videoAllowed) {
        // Credits were already deducted client-side before this call.
        return { ok: false, reason: "LOCKED", refunded: await refund() };
      }
    }


    const { data: signed, error: signErr } = await supabase.storage
      .from("mv-media")
      .createSignedUrl(path, 60 * 30);

    if (signErr || !signed?.signedUrl) {
      return { ok: false, reason: "FAILED", refunded: await refund() };
    }
    const sourceUrl = signed.signedUrl;

    const {
      EngineError,
      runFalEngine,
      runFreePhotoEngine,
    } = await import("./media-pipeline.server");

    try {
      // ---- FREE PIPELINE (never Fal.ai) ----
      if (!isPaid) {
        if (kind === "video") {
          // Lightweight client-side path; no server-side transcode to avoid timeouts.
          return { ok: true, outputUrl: sourceUrl, engine: "client", tier };
        }
        const bytes = await runFreePhotoEngine(sourceUrl);
        const outPath = `${userId}/out-${Date.now()}.png`;
        const { error: upErr } = await supabase.storage
          .from("mv-media")
          .upload(outPath, bytes, { contentType: "image/png", upsert: true });
        if (upErr) throw new EngineError(upErr.message, "FAILED");
        const { data: outSigned } = await supabase.storage
          .from("mv-media")
          .createSignedUrl(outPath, 60 * 60);
        if (!outSigned?.signedUrl) throw new EngineError("No signed output URL", "FAILED");
        return { ok: true, outputUrl: outSigned.signedUrl, engine: "huggingface", tier };
      }

      // ---- PAID VIP PIPELINE (Fal.ai only) ----
      const outputUrl = await runFalEngine(kind, resolution, sourceUrl);
      return { ok: true, outputUrl, engine: "fal", tier };
    } catch (err) {
      const reason =
        err instanceof EngineError ? err.reason : ("FAILED" as const);
      console.error("[media-pipeline]", tier, kind, resolution, reason, err);
      // Paid credits are always returned; free daily quota is restored too.
      return { ok: false, reason, refunded: await refund() };
    }
  });

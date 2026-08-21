import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  path: z.string().min(1),
  kind: z.enum(["photo", "video"]),
  mode: z.enum(["text", "auto", "area"]),
  text: z.string().max(200).optional(),
  maskPath: z.string().optional(),
});

export type RemoveWatermarkResult =
  | { ok: true; outputUrl: string; charged: number }
  | {
      ok: false;
      reason: "RATE_LIMIT" | "TIMEOUT" | "MISSING_KEY" | "FAILED" | "INSUFFICIENT_CREDITS";
    };

/** Fixed MVC price: 1 for images, 2 for videos. */
export function watermarkCost(kind: "photo" | "video") {
  return kind === "photo" ? 1 : 2;
}

/**
 * Credits are checked up-front but only charged AFTER a successful engine run,
 * matching the rest of the app's "deduct on success" policy.
 */
export const removeWatermark = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }): Promise<RemoveWatermarkResult> => {
    const { supabase, userId } = context;
    const { path, kind, mode, text, maskPath } = data;
    void userId;

    const cost = kind === "photo" ? 1 : 2;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = supabase.rpc as any;

    // ---- Step 1: affordability check only ----
    const { data: status } = await rpc("get_credit_status");
    const s = (status ?? {}) as {
      tier?: string;
      pools?: { key: string; remaining: number }[];
    };
    const tier = String(s.tier ?? "free");
    const poolKey = tier === "free" ? kind : "credits";
    const pool = (s.pools ?? []).find((p) => p.key === poolKey);
    if (pool && pool.remaining < cost) {
      return { ok: false, reason: "INSUFFICIENT_CREDITS" };
    }

    const { data: signed } = await supabase.storage
      .from("mv-media")
      .createSignedUrl(path, 60 * 30);
    if (!signed?.signedUrl) return { ok: false, reason: "FAILED" };

    let maskUrl: string | undefined;
    if (maskPath) {
      const { data: m } = await supabase.storage.from("mv-media").createSignedUrl(maskPath, 60 * 30);
      maskUrl = m?.signedUrl ?? undefined;
    }

    const { WatermarkError, removeImageWatermark, removeVideoWatermark } = await import(
      "./watermark.server"
    );

    // ---- Step 2: run the engine ----
    let outputUrl: string;
    try {
      outputUrl =
        kind === "photo"
          ? await removeImageWatermark(signed.signedUrl, mode, { text, maskUrl })
          : await removeVideoWatermark(signed.signedUrl, mode, { text, maskUrl });
    } catch (err) {
      const reason = err instanceof WatermarkError ? err.reason : ("FAILED" as const);
      console.error("[remove-watermark]", kind, mode, reason, err);
      return { ok: false, reason };
    }

    // ---- Step 3: charge only after success ----
    const { data: charge } = await rpc("consume_mvc", { p_kind: kind, p_amount: cost });
    const c = (charge ?? {}) as { success?: boolean; cost?: number };

    return { ok: true, outputUrl, charged: c.success ? Number(c.cost ?? cost) : 0 };
  });

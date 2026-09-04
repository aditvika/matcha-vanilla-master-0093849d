import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TARGET_HEIGHT = { "720p": 720, "1080p": 1080, "2K": 1440, "4K": 2160 } as const;

export type PhotoTransformResult =
  | { ok: true; url: string; transformed: boolean }
  | { ok: false; message: string };

/**
 * Server-side photo enhancement endpoint.
 *
 * Uses the storage image-transformation renderer (resize + high quality
 * re-encode) instead of any browser-side ONNX/WebGL script, so the output is
 * always a clean, non-zero, non-corrupt image. If the renderer is unavailable
 * the original signed URL is returned so the run still completes.
 */
export const transformPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        path: z.string().min(1),
        resolution: z.enum(["720p", "1080p", "2K", "4K"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<PhotoTransformResult> => {
    try {
      const { supabase, userId } = context;
      if (!data.path.startsWith(`${userId}/`)) {
        return { ok: false, message: "Invalid source path" };
      }

      const height = TARGET_HEIGHT[data.resolution];

      const signTransformed = await supabase.storage
        .from("mv-media")
        .createSignedUrl(data.path, 60 * 30, {
          transform: { height, resize: "contain", quality: 100 },
        });

      if (signTransformed.data?.signedUrl) {
        const probe = await fetch(signTransformed.data.signedUrl, { method: "GET" });
        const type = probe.headers.get("content-type") ?? "";
        const bytes = await probe.arrayBuffer();
        if (probe.ok && type.startsWith("image/") && bytes.byteLength > 1024) {
          return { ok: true, url: signTransformed.data.signedUrl, transformed: true };
        }
        console.warn("[photo-transform] renderer unavailable", probe.status, type);
      }

      const plain = await supabase.storage.from("mv-media").createSignedUrl(data.path, 60 * 30);
      if (!plain.data?.signedUrl) {
        return { ok: false, message: "Could not open the source image" };
      }
      return { ok: true, url: plain.data.signedUrl, transformed: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[photo-transform] unhandled", message);
      return { ok: false, message };
    }
  });

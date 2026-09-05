import { useEffect, useRef, useState } from "react";
import { RequireAuth } from "@/components/require-auth";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Zap, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useSelectedMedia } from "@/hooks/use-selected-media";
import { usePremiumStatus } from "@/hooks/use-premium-status";
import { useCredits, refreshCreditsGlobal, broadcastCreditsChanged } from "@/hooks/use-credits";
import {
  completeLocalMedia,
  processMedia,
  refundLocalRun,
} from "@/lib/media-pipeline.functions";
import { processMedia as processMediaService } from "@/lib/media-service";
import { transformPhoto } from "@/lib/photo-transform.functions";


import { uploadProcessedMedia } from "@/lib/media-upload";
import { ensureFreshSession, isAuthError } from "@/lib/session-guard";

const searchSchema = z.object({
  resolution: z.string(),
  path: z.string(),
});

export const Route = createFileRoute("/processing")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Processing — Matcha Vanilla Production" },
      { name: "description", content: "Your media is being processed." },
    ],
  }),
  component: () => (
    <RequireAuth>
      <ProcessingPage />
    </RequireAuth>
  ),
});

const FREE_MESSAGES = [
  "Processing via Standard Server...",
  "Waiting in Queue (Est. 1-2 minutes)",
  "Analyzing frames...",
  "Applying enhancement...",
];
const PREMIUM_MESSAGES = [
  "Processing via Priority GPU Server...",
  "Zero Queue - Priority Lane Active",
  "Rendering at ultra quality...",
];

/** Rejects when no progress has been reported for `stallMs`, so a silent
 *  server hang always reaches the catch block (loader stops + credit refund). */
function withWatchdog<T>(
  work: Promise<T>,
  stallMs: number,
  lastActivity: { current: number },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current > stallMs) {
        clearInterval(timer);
        reject(new Error("Proses tidak merespons (timeout). Kredit dikembalikan."));
      }
    }, 1000);
    work.then(
      (value) => {
        clearInterval(timer);
        resolve(value);
      },
      (error) => {
        clearInterval(timer);
        reject(error);
      },
    );
  });
}

function ProcessingPage() {

  const { media } = useSelectedMedia();
  const { isPremium } = usePremiumStatus();
  useCredits();
  const { resolution, path } = Route.useSearch();
  const navigate = useNavigate();
  const runPipeline = useServerFn(processMedia);
  const completeLocalPipeline = useServerFn(completeLocalMedia);
  const refundLocal = useServerFn(refundLocalRun);
  const runPhotoTransform = useServerFn(transformPhoto);


  const [progress, setProgress] = useState(0);
  const [msgIdx, setMsgIdx] = useState(0);
  const [localMode, setLocalMode] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const startedRef = useRef(false);
  const localRef = useRef(false);
  const chargedRef = useRef(false);
  const lastActivityRef = useRef(Date.now());


  const duration = isPremium ? 4000 : 30000;
  const messages = isPremium ? PREMIUM_MESSAGES : FREE_MESSAGES;

  // Progress + message animation (visual only, paused once local mode owns it).
  useEffect(() => {
    if (!media) {
      void navigate({ to: "/home", replace: true });
      return;
    }
    const start = Date.now();
    const tick = setInterval(() => {
      if (localRef.current) return;
      const elapsed = Date.now() - start;
      setProgress(Math.min(97, (elapsed / duration) * 100));
    }, 100);
    const msgTick = setInterval(
      () => setMsgIdx((i) => (i + 1) % messages.length),
      isPremium ? 1200 : 3500,
    );
    return () => {
      clearInterval(tick);
      clearInterval(msgTick);
    };
  }, [duration, isPremium, media, messages.length, navigate]);

  // Real pipeline execution (free engine vs Fal.ai is decided server-side).
  useEffect(() => {
    if (!media || startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      try {
        // Validate/refresh the session BEFORE any heavy work so an expired
        // token fails gracefully instead of 401-ing mid-render.
        await ensureFreshSession();

        type LooseResult = {
          ok?: boolean;
          reason?: string;
          message?: string;
          outputUrl?: string;
        };
        let result: LooseResult = ((await runPipeline({
          data: {
            path,
            kind: media.kind,
            resolution: resolution as "720p" | "1080p" | "2K" | "4K",
          },
        })) ?? { ok: false, reason: "FAILED" }) as LooseResult;

        if (result?.ok !== true && result?.reason === "LOCAL_FALLBACK") {

          const message = result?.message ?? "";
          console.info(`[media-pipeline] local engine: ${message}`);
          // Credits were validated + deducted server-side before we got here.
          chargedRef.current = true;
          toast.info(
            media.kind === "photo"
              ? "Mode gratis — foto Anda ditingkatkan lewat engine server (stabil & bebas korup)."
              : "Mode gratis — video full-length diproses ke 720p, durasi tidak dipotong.",
            { duration: 6000 },
          );

          localRef.current = true;
          setLocalMode(true);
          setProgress(0);
          setStatusText(
            media.kind === "photo"
              ? "Enhancement Engine — menyiapkan render foto..."
              : "Video Engine — menyiapkan encode full-length...",
          );

          const local = await processMediaService(media.kind, {
            file: media.file,
            sourcePath: path,
            resolution: resolution as "720p" | "1080p" | "2K" | "4K",
            transform: runPhotoTransform as unknown as typeof transformPhoto,
            onStatus: (status: string) => setStatusText(status),
            onProgress: (fraction: number) => {
              const pct = Math.min(97, Math.round(fraction * 100));
              setProgress(pct);
              setStatusText(
                media.kind === "photo"
                  ? `Meningkatkan detail foto ${pct}% — jangan tutup halaman`
                  : `Mengencode video ${pct}% — jangan tutup halaman`,
              );
            },
          });

          setStatusText("Mengunggah hasil...");
          setProgress(98);
          // Rendering can take minutes; refresh the token before upload.
          await ensureFreshSession();
          const userId = path.split("/")[0];
          if (!userId) throw new Error("Invalid media upload path");
          const outputPath = await uploadProcessedMedia(
            local.blob,
            userId,
            local.extension,
            local.contentType,
          );
          result = await completeLocalPipeline({
            data: {
              outputPath,
              kind: media.kind,
              resolution: resolution as "720p" | "1080p" | "2K" | "4K",
            },
          });
        }


        // Always resync from the server clock/balance (charge happens on success only).
        await refreshCreditsGlobal();
        broadcastCreditsChanged();

        if (result?.ok !== true) {
          if (chargedRef.current) {
            chargedRef.current = false;
            try {
              await refundLocal({ data: { kind: media.kind, resolution: resolution as "720p" | "1080p" | "2K" | "4K" } });
              await refreshCreditsGlobal();
              broadcastCreditsChanged();
            } catch (refundError) {
              console.error("[media-pipeline] refund failed:", refundError);
            }
          }
          const reason = result?.reason ?? "FAILED";
          const detail = result?.message ? ` (${result.message})` : "";
          if (reason === "RATE_LIMIT") {
            toast.error("Engine Busy — server gratisan sedang padat, coba lagi sebentar." + detail, {
              duration: 7000,
            });
          } else if (reason === "TIMEOUT") {
            toast.error("Engine Timeout — proses melebihi batas waktu." + detail, {
              duration: 7000,
            });
          } else if (reason === "BAD_KEY") {
            toast.error("Kunci engine premium ditolak." + detail, {
              duration: 8000,
            });

          } else if (reason === "MISSING_KEY") {
            toast.error("Engine key belum dikonfigurasi." + detail, { duration: 8000 });
          } else if (reason === "LOCKED" || reason === "INSUFFICIENT_CREDITS") {
            toast.error(
              "Kredit harian Anda habis. Upgrade ke VIP untuk akses tanpa batas & kualitas 4K!",
            );
          } else {
            toast.error("Gagal memproses media. Kredit tidak terpotong." + detail, {
              duration: 8000,
            });
          }
          void navigate({ to: "/preview", replace: true });
          return;
        }

        setProgress(100);
        setStatusText("Selesai");
        const outputUrl = result.outputUrl ?? "";
        setTimeout(() => {
          void navigate({
            to: "/result",
            search: { resolution, output: outputUrl },
            replace: true,
          });
        }, 350);
      } catch (error) {
        if (chargedRef.current) {
          chargedRef.current = false;
          try {
            await refundLocal({ data: { kind: media.kind, resolution: resolution as "720p" | "1080p" | "2K" | "4K" } });
          } catch (refundError) {
            console.error("[media-pipeline] refund failed:", refundError);
          }
        }
        await refreshCreditsGlobal();
        broadcastCreditsChanged();
        const detail = error instanceof Error ? error.message : String(error);
        console.error("[media-pipeline] client fallback failed:", detail);
        if (isAuthError(error)) {
          toast.error("Sesi Anda berakhir. Silakan masuk kembali — kredit tidak terpotong.", {
            duration: 8000,
          });
          void navigate({ to: "/auth", replace: true });
          return;
        }
        toast.error(`Pemrosesan gagal: ${detail}. Kredit Anda tidak terpotong.`, {
          duration: 8000,
        });
        void navigate({ to: "/preview", replace: true });
      }
    })();
  }, [completeLocalPipeline, media, navigate, path, refundLocal, resolution, runPipeline]);



  if (!media) return null;

  return (
    <main className={`proc-root ${isPremium ? "proc-premium" : "proc-free"}`}>
      <div className="proc-bg" aria-hidden />
      <div className="proc-card">
        <div className="proc-badge">
          {isPremium && !localMode ? (
            <Zap size={14} />
          ) : (
            <Loader2 size={14} className="proc-spin" />
          )}
          <span>{localMode ? "LOCAL ENGINE" : isPremium ? "PRIORITY LANE" : "STANDARD LANE"}</span>
        </div>

        {isPremium && !localMode ? (
          <div className="proc-orbit" aria-hidden>
            <div className="proc-orbit-ring proc-orbit-a" />
            <div className="proc-orbit-ring proc-orbit-b" />
            <div className="proc-orbit-ring proc-orbit-c" />
            <div className="proc-orbit-core">
              <Zap size={28} />
            </div>
          </div>
        ) : (
          <div className="proc-bar-wrap">
            <div className="proc-bar-track">
              <div className="proc-bar-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="proc-bar-pct">{Math.floor(progress)}%</div>
          </div>
        )}

        <p className="proc-message" key={localMode ? "local" : msgIdx}>
          {statusText ?? messages[msgIdx]}
        </p>
        <p className="proc-sub">
          Output resolution: <strong>{resolution}</strong>
        </p>

      </div>
    </main>
  );
}

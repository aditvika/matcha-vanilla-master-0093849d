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
import { completeLocalMedia, processMedia } from "@/lib/media-pipeline.functions";
import { processMediaLocally } from "@/lib/client-media-upscaler";
import { uploadProcessedMedia } from "@/lib/media-upload";

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

function ProcessingPage() {
  const { media } = useSelectedMedia();
  const { isPremium } = usePremiumStatus();
  useCredits();
  const { resolution, path } = Route.useSearch();
  const navigate = useNavigate();
  const runPipeline = useServerFn(processMedia);
  const completeLocalPipeline = useServerFn(completeLocalMedia);
  const [progress, setProgress] = useState(0);
  const [msgIdx, setMsgIdx] = useState(0);
  const [localMode, setLocalMode] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const startedRef = useRef(false);
  const localRef = useRef(false);

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
        let result: Partial<Awaited<ReturnType<typeof runPipeline>>> | undefined =
          await runPipeline({
            data: {
              path,
              kind: media.kind,
              resolution: resolution as "720p" | "1080p" | "2K" | "4K",
            },
          });

        if (result?.ok !== true && result?.reason === "LOCAL_FALLBACK") {
          const message = result?.message ?? "";
          console.warn(`[media-pipeline] ${message} Falling back to local canvas.`);
          const fallbackCause = /401|403|invalid|unauthorized/i.test(message)
            ? "Invalid HF Key"
            : /timed out|timeout/i.test(message)
              ? "Engine Timeout"
              : /429|rate limit|loading|503/i.test(message)
                ? "Engine Busy"
                : "HF Engine Error";
          toast.info(
            media.kind === "photo"
              ? `${fallbackCause} — beralih ke Local Canvas Upscaler di perangkat Anda.`
              : "Video gratis di-upscale frame-by-frame langsung di perangkat Anda.",
            { duration: 6000 },
          );
          localRef.current = true;
          setLocalMode(true);
          setProgress(0);
          setStatusText("Local Canvas Upscaler — memproses di perangkat...");

          const local = await processMediaLocally(
            media.file,
            media.kind,
            resolution as "720p" | "1080p" | "2K" | "4K",
            (fraction) => setProgress(Math.min(97, Math.round(fraction * 95))),
          );
          setStatusText("Mengunggah hasil...");
          setProgress(98);
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
            toast.error("Invalid HF Key — token Hugging Face ditolak (401)." + detail, {
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
        // Nothing is charged before a successful result, so the balance is intact.
        await refreshCreditsGlobal();
        broadcastCreditsChanged();
        const detail = error instanceof Error ? error.message : String(error);
        console.error("[media-pipeline] client fallback failed:", detail);
        toast.error(`Pemrosesan gagal: ${detail}. Kredit Anda tidak terpotong.`, {
          duration: 8000,
        });
        void navigate({ to: "/preview", replace: true });
      }
    })();
  }, [completeLocalPipeline, media, navigate, path, resolution, runPipeline]);



  if (!media) return null;

  return (
    <main className={`proc-root ${isPremium ? "proc-premium" : "proc-free"}`}>
      <div className="proc-bg" aria-hidden />
      <div className="proc-card">
        <div className="proc-badge">
          {isPremium ? <Zap size={14} /> : <Loader2 size={14} className="proc-spin" />}
          <span>{isPremium ? "PRIORITY LANE" : "STANDARD LANE"}</span>
        </div>

        {isPremium ? (
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

        <p className="proc-message" key={msgIdx}>
          {messages[msgIdx]}
        </p>
        <p className="proc-sub">
          Output resolution: <strong>{resolution}</strong>
        </p>
      </div>
    </main>
  );
}

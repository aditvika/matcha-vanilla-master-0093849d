import { useEffect } from "react";
import { RequireAuth } from "@/components/require-auth";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { ArrowLeft, Download, CheckCircle2 } from "lucide-react";
import { useSelectedMedia } from "@/hooks/use-selected-media";
import { usePremiumStatus } from "@/hooks/use-premium-status";

const searchSchema = z.object({ resolution: z.string(), output: z.string().optional() });

export const Route = createFileRoute("/result")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Result — Matcha Vanilla Production" },
      { name: "description", content: "Your processed media is ready." },
    ],
  }),
  component: () => (
    <RequireAuth>
      <ResultPage />
    </RequireAuth>
  ),
});

function ResultPage() {
  const { media, clear } = useSelectedMedia();
  const { isPremium } = usePremiumStatus();
  const { resolution, output } = Route.useSearch();
  const navigate = useNavigate();

  useEffect(() => {
    if (!media) void navigate({ to: "/home", replace: true });
  }, [media, navigate]);

  if (!media) return null;
  const isVideo = media.kind === "video";

  const goHome = () => {
    clear();
    void navigate({ to: "/home" });
  };

  const outUrl = output ?? media.url;

  const handleDownload = async () => {
    const ext = media.file.name.includes(".")
      ? media.file.name.slice(media.file.name.lastIndexOf("."))
      : isVideo
        ? ".mp4"
        : ".jpg";
    const base = media.file.name.replace(/\.[^.]+$/, "") || "media";
    const filename = `MVMaster_${resolution}_${base}${ext}`;

    try {
      // Fetch to blob first so cross-origin storage URLs download properly.
      const res = await fetch(outUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
    } catch {
      // Fallback: direct URL download.
      const a = document.createElement("a");
      a.href = outUrl;
      a.download = filename;
      a.click();
    }
  };

  return (
    <main className={`result-root ${isPremium ? "result-premium" : "result-free"}`}>
      <header className="result-header">
        <button type="button" className="result-back" aria-label="Back" onClick={goHome}>
          <ArrowLeft size={20} />
        </button>
        <div className="result-heading">
          <CheckCircle2 size={18} />
          <h1>Processing Complete</h1>
        </div>
        <span className="result-badge">{resolution}</span>
      </header>

      <section className="result-stage">
        <div className="result-frame">
          {isVideo ? (
            <video src={outUrl} className="result-media" controls playsInline />
          ) : (
            <img src={outUrl} alt="Processed result" className="result-media" />
          )}
        </div>
        <p className="result-caption">Enhanced to {resolution} · {media.file.name}</p>
      </section>

      <section className="result-actions">
        <button type="button" className="result-download" onClick={() => void handleDownload()}>
          <Download size={18} />
          Unduh Hasil
        </button>
        <button type="button" className="result-secondary" onClick={goHome}>
          Back to Home
        </button>
      </section>
    </main>
  );
}

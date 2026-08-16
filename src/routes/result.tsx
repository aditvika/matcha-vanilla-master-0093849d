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

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = outUrl;
    a.download = `enhanced_${resolution}_${media.file.name}`;
    a.click();
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
        <button type="button" className="result-download" onClick={handleDownload}>
          <Download size={18} />
          Download to Gallery
        </button>
        <button type="button" className="result-secondary" onClick={goHome}>
          Back to Home
        </button>
      </section>
    </main>
  );
}

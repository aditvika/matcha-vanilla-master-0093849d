import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  Brush,
  CheckCircle2,
  Download,
  Eraser,
  Home as HomeIcon,
  Loader2,
  Square,
  Sparkles,
  Timer,
} from "lucide-react";
import { RequireAuth } from "@/components/require-auth";
import { useSelectedMedia } from "@/hooks/use-selected-media";
import { useSupabaseSession } from "@/hooks/use-supabase-session";
import { useCredits, refreshCreditsGlobal, broadcastCreditsChanged } from "@/hooks/use-credits";
import { useI18n } from "@/hooks/use-i18n";
import { uploadSourceMedia } from "@/lib/media-upload";
import { removeWatermark } from "@/lib/watermark.functions";
import { SubscriptionModal } from "@/components/subscription-modal";

export const Route = createFileRoute("/watermark")({
  head: () => ({
    meta: [
      { title: "Remove Watermark — Matcha Vanilla Production" },
      {
        name: "description",
        content:
          "Erase watermarks from photos and videos with AI: by text, automatic detection, or by selecting an area.",
      },
      { property: "og:title", content: "Remove Watermark — Matcha Vanilla Production" },
      {
        property: "og:description",
        content: "Erase watermarks from photos and videos with AI in a few taps.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <WatermarkPage />
    </RequireAuth>
  ),
});

type Mode = "text" | "auto" | "area";
type Tool = "brush" | "rect";

function WatermarkPage() {
  const { media, clear } = useSelectedMedia();
  const { user } = useSupabaseSession();
  const { poolFor } = useCredits();
  const { t } = useI18n();
  const navigate = useNavigate();
  const runRemove = useServerFn(removeWatermark);

  const [mode, setMode] = useState<Mode>("text");
  const [tool, setTool] = useState<Tool>("brush");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [subOpen, setSubOpen] = useState(false);
  const [hasMask, setHasMask] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const snapshot = useRef<ImageData | null>(null);

  useEffect(() => {
    if (!media) void navigate({ to: "/home", replace: true });
  }, [media, navigate]);

  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const r = stage.getBoundingClientRect();
    if (canvas.width === Math.round(r.width) && canvas.height === Math.round(r.height)) return;
    canvas.width = Math.round(r.width);
    canvas.height = Math.round(r.height);
  }, []);

  useEffect(() => {
    sizeCanvas();
    window.addEventListener("resize", sizeCanvas);
    return () => window.removeEventListener("resize", sizeCanvas);
  }, [sizeCanvas, mode]);

  if (!media) return null;

  const kind = media.kind;
  const cost = kind === "photo" ? 1 : 2;
  const pool = poolFor(kind);
  const remaining = pool?.remaining ?? 0;

  const clearMask = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasMask(false);
  };

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== "area") return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    start.current = pos(e);
    if (tool === "rect") {
      snapshot.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } else {
      ctx.beginPath();
      ctx.moveTo(start.current.x, start.current.y);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || mode !== "area") return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const p = pos(e);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    if (tool === "brush") {
      ctx.lineWidth = 26;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    } else if (start.current) {
      if (snapshot.current) ctx.putImageData(snapshot.current, 0, 0);
      ctx.fillRect(start.current.x, start.current.y, p.x - start.current.x, p.y - start.current.y);
    }
    setHasMask(true);
  };

  const onPointerUp = () => {
    drawing.current = false;
    start.current = null;
    snapshot.current = null;
  };

  const maskBlob = async (): Promise<Blob | null> => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
    return new Promise((resolve) => out.toBlob((b) => resolve(b), "image/png"));
  };

  const handleRemove = async () => {
    if (busy || !user) return;
    if (mode === "text" && !text.trim()) return toast.error(t("wm.textRequired"));
    if (mode === "area" && !hasMask) return toast.error(t("wm.areaRequired"));
    if (remaining < cost) {
      toast.error(t("wm.insufficient"));
      setSubOpen(true);
      return;
    }

    setBusy(true);
    try {
      const path = await uploadSourceMedia(media.file, user.id).catch(() => null);
      if (!path) {
        toast.error(t("wm.uploadFailed"));
        setBusy(false);
        return;
      }

      let maskPath: string | undefined;
      if (mode === "area") {
        const blob = await maskBlob();
        if (blob) {
          const file = new File([blob], `mask-${Date.now()}.png`, { type: "image/png" });
          maskPath = (await uploadSourceMedia(file, user.id).catch(() => null)) ?? undefined;
        }
      }

      const res = await runRemove({
        data: {
          path,
          kind,
          mode,
          ...(mode === "text" ? { text: text.trim() } : {}),
          ...(maskPath ? { maskPath } : {}),
        },
      });

      await refreshCreditsGlobal();
      broadcastCreditsChanged();

      if (!res.ok) {
        if (res.reason === "RATE_LIMIT" || res.reason === "TIMEOUT") toast.error(t("wm.busy"));
        else if (res.reason === "INSUFFICIENT_CREDITS") {
          toast.error(t("wm.insufficient"));
          setSubOpen(true);
        } else toast.error(t("wm.failed"));
        setBusy(false);
        return;
      }

      setOutput(res.outputUrl);
      toast.success(`${t("wm.done")} · ${res.charged} ${t("wm.charged")}`);
    } catch {
      await refreshCreditsGlobal();
      broadcastCreditsChanged();
      toast.error(t("wm.failed"));
    } finally {
      setBusy(false);
    }
  };

  const goHome = () => {
    clear();
    void navigate({ to: "/home" });
  };

  const save = () => {
    if (!output) return;
    const a = document.createElement("a");
    a.href = output;
    a.download = `nowatermark_${media.file.name}`;
    a.target = "_blank";
    a.rel = "noopener";
    a.click();
    toast.success(t("wm.saved"));
  };

  const previewUrl = output ?? media.url;

  return (
    <main className="wm-root">
      <header className="wm-header">
        <button type="button" className="preview-back" aria-label="Back" onClick={goHome}>
          <ArrowLeft size={20} />
        </button>
        <div className="preview-heading">
          <Eraser size={18} />
          <h1>{t("wm.title")}</h1>
        </div>
        <span className="preview-badge">
          {cost} {t("wm.mvc")}
        </span>
      </header>

      <section className="wm-stage-wrap" aria-label={t("wm.title")}>
        <div className="wm-stage" ref={stageRef}>
          {kind === "video" ? (
            <video src={previewUrl} className="wm-media" controls playsInline />
          ) : (
            <img src={previewUrl} alt={t("wm.title")} className="wm-media" />
          )}
          {mode === "area" && !output && (
            <canvas
              ref={canvasRef}
              className="wm-canvas"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          )}
          {busy && (
            <div className="wm-overlay">
              <Loader2 size={28} className="proc-spin" />
              <p>{t("wm.processing")}</p>
              <span>
                {t("wm.estimate")}: {kind === "photo" ? t("wm.estImage") : t("wm.estVideo")}
              </span>
            </div>
          )}
        </div>
      </section>

      {output ? (
        <section className="wm-panel">
          <p className="wm-done">
            <CheckCircle2 size={16} /> {t("wm.done")}
          </p>
          <button type="button" className="preview-cta" onClick={save}>
            <Download size={16} /> {t("wm.saveGallery")}
          </button>
          <button type="button" className="wm-secondary" onClick={goHome}>
            <HomeIcon size={16} /> {t("wm.backHome")}
          </button>
        </section>
      ) : (
        <section className="wm-panel">
          <div className="wm-tabs" role="tablist">
            {(
              [
                ["text", t("wm.tabText")],
                ["auto", t("wm.tabAuto")],
                ["area", t("wm.tabArea")],
              ] as [Mode, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mode === key}
                className={`wm-tab ${mode === key ? "wm-tab-active" : ""}`}
                onClick={() => setMode(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "text" && (
            <div className="wm-field">
              <label htmlFor="wm-text">{t("wm.textLabel")}</label>
              <input
                id="wm-text"
                className="wm-input"
                value={text}
                placeholder={t("wm.textPlaceholder")}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
          )}

          {mode === "auto" && (
            <p className="wm-note">
              <Sparkles size={14} /> {t("wm.autoNote")}
            </p>
          )}

          {mode === "area" && (
            <div className="wm-area">
              <div className="wm-tools">
                <button
                  type="button"
                  className={`wm-tool ${tool === "brush" ? "wm-tool-active" : ""}`}
                  onClick={() => setTool("brush")}
                >
                  <Brush size={14} /> {t("wm.brush")}
                </button>
                <button
                  type="button"
                  className={`wm-tool ${tool === "rect" ? "wm-tool-active" : ""}`}
                  onClick={() => setTool("rect")}
                >
                  <Square size={14} /> {t("wm.rectangle")}
                </button>
                <button type="button" className="wm-tool" onClick={clearMask}>
                  {t("wm.clearMask")}
                </button>
              </div>
              <p className="wm-note">{t("wm.areaNote")}</p>
            </div>
          )}

          <p className="wm-meta">
            <Timer size={13} /> {t("wm.estimate")}:{" "}
            {kind === "photo" ? t("wm.estImage") : t("wm.estVideo")} · {t("wm.cost")}: {cost}{" "}
            {t("wm.mvc")}
          </p>

          <button
            type="button"
            className="preview-cta"
            disabled={busy}
            onClick={() => void handleRemove()}
          >
            {busy ? t("wm.processing") : t("wm.removeNow")}
          </button>
        </section>
      )}

      <SubscriptionModal open={subOpen} onOpenChange={setSubOpen} />
    </main>
  );
}

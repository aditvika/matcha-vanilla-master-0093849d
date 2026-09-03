import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  Brush,
  CheckCircle2,
  Download,
  Eraser,
  Hand,
  Home as HomeIcon,
  Loader2,
  Maximize,
  Minus,
  Plus,
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
type Tool = "brush" | "rect" | "pan";
type Rect = { x: number; y: number; w: number; h: number };
type Handle = "nw" | "ne" | "sw" | "se" | "move" | null;

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const HANDLE = 16;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function normalize(r: Rect): Rect {
  return {
    x: r.w < 0 ? r.x + r.w : r.x,
    y: r.h < 0 ? r.y + r.h : r.y,
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  };
}

function WatermarkPage() {
  const { media, clear } = useSelectedMedia();
  const { user } = useSupabaseSession();
  const { poolFor } = useCredits();
  const { t } = useI18n();
  const navigate = useNavigate();
  const runRemove = useServerFn(removeWatermark);

  const [mode, setMode] = useState<Mode>("text");
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(26);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [subOpen, setSubOpen] = useState(false);
  const [hasMask, setHasMask] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const strokesRef = useRef<HTMLCanvasElement | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const drawing = useRef(false);
  const dragHandle = useRef<Handle>(null);
  const dragStart = useRef<{ x: number; y: number; rect: Rect | null } | null>(null);
  const panning = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const viewRef = useRef({ zoom: 1, offset: { x: 0, y: 0 } });

  viewRef.current = { zoom, offset };

  useEffect(() => {
    if (!media) void navigate({ to: "/home", replace: true });
  }, [media, navigate]);

  /** Repaint the visible mask canvas: freehand strokes + rectangle + handles. */
  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (strokesRef.current) ctx.drawImage(strokesRef.current, 0, 0);
    const r = rectRef.current;
    if (r) {
      const n = normalize(r);
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillRect(n.x, n.y, n.w, n.h);
      ctx.strokeStyle = "rgba(120,255,190,0.95)";
      ctx.lineWidth = 2 / viewRef.current.zoom;
      ctx.strokeRect(n.x, n.y, n.w, n.h);
      const h = HANDLE / viewRef.current.zoom;
      ctx.fillStyle = "rgba(120,255,190,0.95)";
      for (const [hx, hy] of [
        [n.x, n.y],
        [n.x + n.w, n.y],
        [n.x, n.y + n.h],
        [n.x + n.w, n.y + n.h],
      ]) {
        ctx.fillRect(hx - h / 2, hy - h / 2, h, h);
      }
    }
  }, []);

  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const surface = surfaceRef.current;
    if (!canvas || !surface) return;
    const r = surface.getBoundingClientRect();
    const w = Math.round(r.width / viewRef.current.zoom);
    const h = Math.round(r.height / viewRef.current.zoom);
    if (!w || !h) return;
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    const strokes = strokesRef.current ?? document.createElement("canvas");
    strokes.width = w;
    strokes.height = h;
    strokesRef.current = strokes;
    repaint();
  }, [repaint]);

  useEffect(() => {
    sizeCanvas();
    window.addEventListener("resize", sizeCanvas);
    return () => window.removeEventListener("resize", sizeCanvas);
  }, [sizeCanvas, mode]);

  /** Native non-passive wheel listener for cursor-anchored zoom. */
  const zoomAtRef = useRef<(px: number, py: number, next: number) => void>(() => {});
  zoomAtRef.current = (px, py, nextRaw) => {
    const next = clamp(nextRaw, MIN_ZOOM, MAX_ZOOM);
    const { zoom: z, offset: o } = viewRef.current;
    if (next === z) return;
    const k = next / z;
    setOffset({ x: px - (px - o.x) * k, y: py - (py - o.y) * k });
    setZoom(next);
  };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      zoomAtRef.current(
        e.clientX - rect.left,
        e.clientY - rect.top,
        viewRef.current.zoom * Math.exp(-dy * 0.0015),
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    zoomAtRef.current(r.width / 2, r.height / 2, viewRef.current.zoom * factor);
  };

  const resetView = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const canDraw = mode === "area" && !output && tool !== "pan";

  const toCanvas = (e: React.PointerEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const hitHandle = (p: { x: number; y: number }): Handle => {
    const r = rectRef.current;
    if (!r) return null;
    const n = normalize(r);
    const h = (HANDLE * 1.4) / viewRef.current.zoom;
    const near = (hx: number, hy: number) => Math.abs(p.x - hx) < h && Math.abs(p.y - hy) < h;
    if (near(n.x, n.y)) return "nw";
    if (near(n.x + n.w, n.y)) return "ne";
    if (near(n.x, n.y + n.h)) return "sw";
    if (near(n.x + n.w, n.y + n.h)) return "se";
    if (p.x > n.x && p.x < n.x + n.w && p.y > n.y && p.y < n.y + n.h) return "move";
    return null;
  };

  const startPan = (e: React.PointerEvent) => {
    panning.current = {
      x: e.clientX,
      y: e.clientY,
      ox: viewRef.current.offset.x,
      oy: viewRef.current.offset.y,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a && b) pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: viewRef.current.zoom };
      drawing.current = false;
      panning.current = null;
      return;
    }

    if (!canDraw) {
      startPan(e);
      return;
    }

    const p = toCanvas(e, canvas);
    if (tool === "rect") {
      const hit = hitHandle(p);
      if (hit) {
        dragHandle.current = hit;
        dragStart.current = { x: p.x, y: p.y, rect: rectRef.current };
        return;
      }
      dragHandle.current = "se";
      rectRef.current = { x: p.x, y: p.y, w: 0, h: 0 };
      dragStart.current = { x: p.x, y: p.y, rect: rectRef.current };
      drawing.current = true;
      repaint();
      return;
    }

    // brush
    drawing.current = true;
    const sctx = strokesRef.current?.getContext("2d");
    if (sctx) {
      sctx.strokeStyle = "rgba(255,255,255,0.95)";
      sctx.lineWidth = brushSize;
      sctx.lineCap = "round";
      sctx.lineJoin = "round";
      sctx.beginPath();
      sctx.moveTo(p.x, p.y);
      sctx.lineTo(p.x + 0.01, p.y);
      sctx.stroke();
    }
    setHasMask(true);
    repaint();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (canDraw && tool === "brush") setCursor(toCanvas(e, canvas));

    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = stageRef.current?.getBoundingClientRect();
      if (rect) {
        zoomAtRef.current(
          (a.x + b.x) / 2 - rect.left,
          (a.y + b.y) / 2 - rect.top,
          pinch.current.zoom * (dist / pinch.current.dist),
        );
      }
      return;
    }

    if (panning.current) {
      setOffset({
        x: panning.current.ox + (e.clientX - panning.current.x),
        y: panning.current.oy + (e.clientY - panning.current.y),
      });
      return;
    }

    if (!canDraw) return;
    const p = toCanvas(e, canvas);

    if (tool === "rect") {
      const h = dragHandle.current;
      const s = dragStart.current;
      if (!h || !s || !s.rect) return;
      const base = normalize(s.rect);
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      if (h === "move") {
        rectRef.current = { ...base, x: base.x + dx, y: base.y + dy };
      } else if (drawing.current) {
        rectRef.current = { x: s.x, y: s.y, w: p.x - s.x, h: p.y - s.y };
      } else if (h === "se") {
        rectRef.current = { x: base.x, y: base.y, w: base.w + dx, h: base.h + dy };
      } else if (h === "nw") {
        rectRef.current = { x: base.x + dx, y: base.y + dy, w: base.w - dx, h: base.h - dy };
      } else if (h === "ne") {
        rectRef.current = { x: base.x, y: base.y + dy, w: base.w + dx, h: base.h - dy };
      } else if (h === "sw") {
        rectRef.current = { x: base.x + dx, y: base.y, w: base.w - dx, h: base.h + dy };
      }
      const n = rectRef.current ? normalize(rectRef.current) : null;
      setHasMask(!!n && n.w > 2 && n.h > 2);
      repaint();
      return;
    }

    if (!drawing.current) return;
    const sctx = strokesRef.current?.getContext("2d");
    if (sctx) {
      sctx.lineWidth = brushSize;
      sctx.lineTo(p.x, p.y);
      sctx.stroke();
    }
    setHasMask(true);
    repaint();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    drawing.current = false;
    dragHandle.current = null;
    dragStart.current = null;
    panning.current = null;
  };

  const clearMask = () => {
    const strokes = strokesRef.current;
    const sctx = strokes?.getContext("2d");
    if (strokes && sctx) sctx.clearRect(0, 0, strokes.width, strokes.height);
    rectRef.current = null;
    setHasMask(false);
    repaint();
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
    ctx.fillStyle = "#ffffff";
    if (strokesRef.current) ctx.drawImage(strokesRef.current, 0, 0);
    const r = rectRef.current;
    if (r) {
      const n = normalize(r);
      ctx.fillRect(n.x, n.y, n.w, n.h);
    }
    return new Promise((resolve) => out.toBlob((b) => resolve(b), "image/png"));
  };

  const kind = media?.kind ?? "photo";
  const cost = kind === "photo" ? 1 : 2;
  const pool = poolFor(kind);
  const remaining = pool?.remaining ?? 0;
  const previewUrl = output ?? media?.url ?? "";

  const surfaceStyle = useMemo(
    () => ({
      transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
      transformOrigin: "0 0" as const,
    }),
    [offset.x, offset.y, zoom],
  );

  if (!media) return null;

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
          <div className="wm-surface" ref={surfaceRef} style={surfaceStyle}>
            {kind === "video" ? (
              <video src={previewUrl} className="wm-media" controls playsInline />
            ) : (
              <img src={previewUrl} alt={t("wm.title")} className="wm-media" />
            )}
            {!output && (
              <canvas
                ref={canvasRef}
                className="wm-canvas"
                style={{
                  cursor: canDraw ? "crosshair" : "grab",
                  // Video keeps its native controls usable: the overlay only
                  // takes pointer events while an area tool is active, and it
                  // never covers the bottom control bar.
                  pointerEvents: kind === "video" && !canDraw ? "none" : "auto",
                  bottom: kind === "video" ? 64 : 0,
                  touchAction: kind === "video" && !canDraw ? "auto" : "none",
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={() => setCursor(null)}
                onPointerCancel={onPointerUp}
              />
            )}
            {canDraw && tool === "brush" && cursor && (
              <span
                className="wm-brush-cursor"
                style={{
                  left: cursor.x,
                  top: cursor.y,
                  width: brushSize,
                  height: brushSize,
                }}
              />
            )}
          </div>

          <div className="wm-zoom">
            <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
              <Plus size={15} />
            </button>
            <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
              <Minus size={15} />
            </button>
            <button type="button" aria-label="Reset zoom" onClick={resetView}>
              <Maximize size={15} />
            </button>
            <span className="wm-zoom-level">{Math.round(zoom * 100)}%</span>
          </div>

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
          <div className="wm-actions">
            <button type="button" className="preview-cta" onClick={save}>
              <Download size={16} /> {t("wm.saveGallery")}
            </button>
            <button type="button" className="wm-secondary" onClick={goHome}>
              <HomeIcon size={16} /> {t("wm.backHome")}
            </button>
          </div>
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
              <input
                id="wm-text"
                className="wm-input"
                value={text}
                aria-label={t("wm.textLabel")}
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
                <button
                  type="button"
                  className={`wm-tool ${tool === "pan" ? "wm-tool-active" : ""}`}
                  aria-label="Pan"
                  onClick={() => setTool("pan")}
                >
                  <Hand size={14} />
                </button>
                <button type="button" className="wm-tool" onClick={clearMask}>
                  {t("wm.clearMask")}
                </button>
              </div>

              {tool === "brush" && (
                <label className="wm-slider">
                  <span>{brushSize}px</span>
                  <input
                    type="range"
                    min={5}
                    max={50}
                    value={brushSize}
                    aria-label={t("wm.brush")}
                    onChange={(e) => setBrushSize(Number(e.target.value))}
                  />
                </label>
              )}
            </div>
          )}

          <div className="wm-bottom">
            <p className="wm-meta">
              <Timer size={13} /> {kind === "photo" ? t("wm.estImage") : t("wm.estVideo")} ·{" "}
              {t("wm.cost")}: {cost} {t("wm.mvc")}
            </p>
            <button
              type="button"
              className="preview-cta"
              disabled={busy}
              onClick={() => void handleRemove()}
            >
              {busy ? t("wm.processing") : t("wm.removeNow")}
            </button>
          </div>
        </section>
      )}

      <SubscriptionModal open={subOpen} onOpenChange={setSubOpen} />
    </main>
  );
}

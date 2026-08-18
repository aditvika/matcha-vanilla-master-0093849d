import { useEffect, useRef, useState } from "react";
import beforeAsset from "@/assets/showcase-before.jpg.asset.json";
import afterAsset from "@/assets/showcase-after.jpg.asset.json";
import officialAsset from "@/assets/banner-official.jpg.asset.json";
import supportAsset from "@/assets/banner-support.jpg.asset.json";

const AUTOPLAY_MS = 4500;
const SLIDE_COUNT = 3;
const SWIPE_THRESHOLD = 45;

type HeroCarouselProps = {
  isPremium: boolean;
  onUpgrade: () => void;
};

export function HeroCarousel({ isPremium, onUpgrade }: HeroCarouselProps) {
  const [index, setIndex] = useState(0);
  const [timerKey, setTimerKey] = useState(0);
  const [reveal, setReveal] = useState(0);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  // Auto-play (restarts whenever the user swipes)
  useEffect(() => {
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % SLIDE_COUNT),
      AUTOPLAY_MS,
    );
    return () => window.clearInterval(id);
  }, [timerKey]);

  // Infinite ping-pong scanner (never stops)
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = ((now - start) / 3000) % 2;
      setReveal(t <= 1 ? t : 2 - t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const goTo = (i: number) => {
    setIndex(((i % SLIDE_COUNT) + SLIDE_COUNT) % SLIDE_COUNT);
    setTimerKey((k) => k + 1);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.x) > 8) d.moved = true;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      goTo(index + (dx < 0 ? 1 : -1));
      return;
    }
    if (!d.moved && index === 0 && !isPremium) onUpgrade();
  };

  return (
    <section
      aria-label="Highlights"
      className="relative w-full overflow-hidden rounded-2xl"
    >
      <div
        className="relative w-full aspect-video touch-pan-y select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (dragRef.current = null)}
      >
        {/* Slide 1 — before/after showcase */}
        <div
          className={`absolute inset-0 transition-opacity duration-700 ${
            index === 0 ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <div
            role={!isPremium ? "button" : undefined}
            tabIndex={!isPremium ? 0 : -1}
            aria-label={!isPremium ? "Upgrade ke Premium" : undefined}
            onKeyDown={
              !isPremium
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") onUpgrade();
                  }
                : undefined
            }
            className={`relative h-full w-full select-none ${
              !isPremium ? "cursor-pointer" : ""
            }`}
          >
            <img
              src={beforeAsset.url}
              alt="Hasil sebelum ditingkatkan"
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              draggable={false}
              loading="lazy"
            />
            <div
              className="pointer-events-none absolute inset-0 overflow-hidden"
              style={{ width: `${reveal * 100}%` }}
            >
              <img
                src={afterAsset.url}
                alt="Hasil setelah ditingkatkan HD"
                className="absolute inset-0 h-full w-full object-cover"
                style={{ width: `${100 / Math.max(reveal, 0.001)}%` }}
                draggable={false}
                loading="lazy"
              />
            </div>
            <div
              className="pointer-events-none absolute inset-y-0 w-[2px] bg-white/90 shadow-[0_0_14px_3px_rgba(255,255,255,0.6)]"
              style={{ left: `${reveal * 100}%` }}
              aria-hidden
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-3 pb-6 pt-8 text-[11px] font-semibold text-white/90">
              <span>BEFORE</span>
              <span>{isPremium ? "VIP SHOWCASE" : "AFTER · HD"}</span>
            </div>
          </div>
        </div>

        {/* Slide 2 — official */}
        <a
          href="https://linktr.ee/ADVIK_owner"
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            if (dragRef.current?.moved) e.preventDefault();
          }}
          className={`absolute inset-0 transition-opacity duration-700 ${
            index === 1 ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          aria-label="AV Studio Official"
        >
          <img
            src={officialAsset.url}
            alt="AV Studio Official"
            className="pointer-events-none h-full w-full object-cover"
            draggable={false}
            loading="lazy"
          />
        </a>

        {/* Slide 3 — support */}
        <a
          href="https://wa.me/62895365351729"
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            if (dragRef.current?.moved) e.preventDefault();
          }}
          className={`absolute inset-0 transition-opacity duration-700 ${
            index === 2 ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          aria-label="Customer Support WhatsApp"
        >
          <img
            src={supportAsset.url}
            alt="Customer Support & Help Center"
            className="pointer-events-none h-full w-full object-cover"
            draggable={false}
            loading="lazy"
          />
        </a>

        {/* Pagination */}
        <div className="absolute inset-x-0 bottom-2 z-10 flex items-center justify-center gap-2">
          {Array.from({ length: SLIDE_COUNT }).map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Slide ${i + 1}`}
              onClick={() => goTo(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === index
                  ? "w-5 bg-primary shadow-[0_0_10px_2px_hsl(var(--primary)/0.7)]"
                  : "w-1.5 bg-white/40"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

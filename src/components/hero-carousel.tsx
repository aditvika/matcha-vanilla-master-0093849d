import { useCallback, useEffect, useRef, useState } from "react";
import beforeAsset from "@/assets/showcase-before.jpg.asset.json";
import afterAsset from "@/assets/showcase-after.jpg.asset.json";
import officialAsset from "@/assets/banner-official.jpg.asset.json";
import supportAsset from "@/assets/banner-support.jpg.asset.json";

const AUTOPLAY_MS = 4500;
const SLIDE_COUNT = 3;

type HeroCarouselProps = {
  isPremium: boolean;
  onUpgrade: () => void;
};

export function HeroCarousel({ isPremium, onUpgrade }: HeroCarouselProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reveal, setReveal] = useState(0.5);
  const scanRef = useRef<number | null>(null);

  // Auto-play
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % SLIDE_COUNT),
      AUTOPLAY_MS,
    );
    return () => window.clearInterval(id);
  }, [paused]);

  // Auto-scanning divider on slide 1
  useEffect(() => {
    if (index !== 0 || paused) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = ((now - start) / 3000) % 2;
      setReveal(t <= 1 ? t : 2 - t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    scanRef.current = raf;
    return () => cancelAnimationFrame(raf);
  }, [index, paused]);

  const handleScrub = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      setReveal(Math.min(1, Math.max(0, x)));
    },
    [],
  );

  const slide1Interactive = !isPremium;

  return (
    <section
      aria-label="Highlights"
      className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-[0_10px_40px_-15px_rgba(0,0,0,0.8)] backdrop-blur-md"
    >
      <div className="relative w-full aspect-video">
        {/* Slide 1 — before/after showcase */}
        <div
          className={`absolute inset-0 transition-opacity duration-700 ${
            index === 0 ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <div
            role={slide1Interactive ? "button" : undefined}
            tabIndex={slide1Interactive ? 0 : -1}
            aria-label={slide1Interactive ? "Upgrade ke Premium" : undefined}
            onClick={slide1Interactive ? onUpgrade : undefined}
            onKeyDown={
              slide1Interactive
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") onUpgrade();
                  }
                : undefined
            }
            onPointerEnter={() => setPaused(true)}
            onPointerLeave={() => {
              setPaused(false);
            }}
            onPointerDown={(e) => {
              setPaused(true);
              handleScrub(e);
            }}
            onPointerMove={(e) => {
              if (e.buttons > 0 || e.pointerType === "touch") handleScrub(e);
            }}
            className={`relative h-full w-full select-none ${
              slide1Interactive
                ? "cursor-pointer transition-shadow hover:shadow-[inset_0_0_60px_rgba(168,85,247,0.35)]"
                : "pointer-events-none"
            }`}
          >
            <img
              src={beforeAsset.url}
              alt="Hasil sebelum ditingkatkan"
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
            />
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${reveal * 100}%` }}
            >
              <img
                src={afterAsset.url}
                alt="Hasil setelah ditingkatkan HD"
                className="absolute inset-0 h-full w-full object-cover"
                style={{ width: `${100 / Math.max(reveal, 0.001)}%` }}
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
          className={`absolute inset-0 transition-opacity duration-700 ${
            index === 1 ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          aria-label="AV Studio Official"
        >
          <img
            src={officialAsset.url}
            alt="AV Studio Official"
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </a>

        {/* Slide 3 — support */}
        <a
          href="https://wa.me/62895365351729"
          target="_blank"
          rel="noopener noreferrer"
          className={`absolute inset-0 transition-opacity duration-700 ${
            index === 2 ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          aria-label="Customer Support WhatsApp"
        >
          <img
            src={supportAsset.url}
            alt="Customer Support & Help Center"
            className="h-full w-full object-cover"
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
              onClick={() => setIndex(i)}
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

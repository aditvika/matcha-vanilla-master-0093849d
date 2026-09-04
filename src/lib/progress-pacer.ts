/**
 * Organic progress pacing.
 *
 * The real engines report progress in bursts (or not at all), which feels
 * broken to users. The pacer drives a smooth, non-linear curve with gentle
 * random fluctuation towards a randomized target duration, and never passes
 * the ceiling until the real work resolves.
 */

export type PaceRange = { minMs: number; maxMs: number };

export const PHOTO_PACE: PaceRange = { minMs: 20_000, maxMs: 40_000 };
export const VIDEO_PACE: PaceRange = { minMs: 40_000, maxMs: 120_000 };

/** Biases the random pick towards the middle of the range (natural average). */
function naturalDuration({ minMs, maxMs }: PaceRange) {
  const a = Math.random();
  const b = Math.random();
  const centered = (a + b) / 2; // triangular distribution, peaks at 0.5
  return minMs + (maxMs - minMs) * centered;
}

export type Pacer = {
  /** Blend a real engine fraction (0..1) into the simulated curve. */
  report: (fraction: number) => void;
  /** Snap to 100% and stop the timer. */
  finish: () => void;
  stop: () => void;
};

export function startPacer(range: PaceRange, onProgress: (fraction: number) => void): Pacer {
  const total = naturalDuration(range);
  const started = Date.now();
  const ceiling = 0.97;
  let shown = 0;
  let real = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = () => {
    const t = Math.min(1, (Date.now() - started) / total);
    // Ease-out curve: fast start, long organic tail.
    const eased = 1 - Math.pow(1 - t, 2.2);
    const jitter = (Math.random() - 0.35) * 0.006;
    const simulated = Math.min(ceiling, eased * ceiling + jitter);
    const next = Math.max(shown, Math.min(ceiling, Math.max(simulated, real * ceiling)));
    if (next > shown) {
      shown = next;
      onProgress(shown);
    }
  };

  timer = setInterval(tick, 180);
  tick();

  return {
    report: (fraction: number) => {
      if (Number.isFinite(fraction)) real = Math.max(0, Math.min(1, fraction));
    },
    finish: () => {
      if (timer) clearInterval(timer);
      timer = null;
      shown = 1;
      onProgress(1);
    },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

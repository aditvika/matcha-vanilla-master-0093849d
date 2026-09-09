/**
 * Organic progress pacing.
 *
 * IMPORTANT (bug history): the pacer used to be a pure simulation with a hard
 * 0.97 ceiling. On long video encodes the simulation always reached that
 * ceiling in ~1 minute while FFmpeg was still working, so the UI froze at
 * "97%". Worse, `onProgress` was only called when the number moved, so the
 * caller's stall watchdog saw no activity and eventually aborted a perfectly
 * healthy encode.
 *
 * Now:
 *  - Once the engine reports real progress, the real value drives the bar and
 *    the simulation can never run ahead of it.
 *  - Every tick emits a value (even an unchanged one) as a heartbeat, so
 *    watchdogs upstream know work is still alive.
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
  const ceiling = 0.99;
  /**
   * Simulation only covers engine startup. Encoding progress owns the rest of
   * the bar, so a missing engine signal is obvious instead of looking like a
   * real conversion that has completed 90%.
   */
  const simCeiling = 0.12;
  let shown = 0;
  let real = 0;
  let realSeen = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = () => {
    const t = Math.min(1, (Date.now() - started) / total);
    // Ease-out curve: fast start, long organic tail.
    const eased = 1 - Math.pow(1 - t, 2.2);
    const jitter = (Math.random() - 0.35) * 0.006;
    const simulated = Math.min(simCeiling, eased * simCeiling + jitter);

    // Reserve the final 4% for output validation/upload. Once real engine data
    // exists it maps monotonically from 12% through 96%.
    const target = realSeen
      ? Math.min(0.96, Math.max(shown, simCeiling + real * (0.96 - simCeiling)))
      : simulated;

    if (target > shown) shown = target;
    // Emit every tick — an unchanged value still counts as a liveness signal.
    onProgress(shown);
  };

  timer = setInterval(tick, 180);
  tick();

  return {
    report: (fraction: number) => {
      if (!Number.isFinite(fraction)) return;
      realSeen = true;
      real = Math.max(real, Math.max(0, Math.min(1, fraction)));
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

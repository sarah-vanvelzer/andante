// label-free step detector
// signal = vertical spread of the 6 foot points / leg length, smoothed,
// with thresholds that adapt to the last 2 seconds of movement
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export const CFG = {
  alpha: 0.35, // smoothing strength (EMA); belnds each new value with previous
  windowMs: 2000, // how far back the thresholds look
  hiFrac: 0.6, // "foot is up" threshold, as a fraction of the range
  loFrac: 0.35, // "foot is down again" threshold
  minRange: 0.05, // ignore tiny wiggles (standing still)
  minStepGapMs: 250, // max 240 steps/min
  cadenceGaps: 7, // cadence uses the last 7 step gaps
  minAnkleVis: 0.5, // skip frames where ankles aren't clearly visible
  steadySpread: 0.35, // beat-lock rule (used in Block 2)
};

const FOOT = [27, 28, 29, 30, 31, 32]; // ankles, heels, toes

export type Sample = { t: number; v: number; hi: number; lo: number; valid: boolean };

export class StepDetector {
  private ema: number | null = null;
  private hist: { t: number; v: number }[] = [];
  private above = false;
  stepTimes: number[] = [];
  stepCount = 0;

  reset() {
    this.ema = null;
    this.hist = [];
    this.above = false;
    this.stepTimes = [];
    this.stepCount = 0;
  }

  // feed one frame
  // returns the sample (for the graph) and whether a step happened
  update(lm: NormalizedLandmark[] | undefined, t: number): { sample: Sample | null; step: boolean } {
    const raw = lm ? footGap(lm) : null;
    if (raw === null) return { sample: null, step: false };

    // smooth
    this.ema = this.ema === null ? raw : CFG.alpha * raw + (1 - CFG.alpha) * this.ema;
    const v = this.ema;

    // keep the last 2 s and find its lowest and highest values
    this.hist.push({ t, v });
    while (this.hist.length && this.hist[0].t < t - CFG.windowMs) this.hist.shift();
    let min = Infinity, max = -Infinity;
    for (const h of this.hist) { if (h.v < min) min = h.v; if (h.v > max) max = h.v; }
    const range = max - min;
    const hi = min + CFG.hiFrac * range;
    const lo = min + CFG.loFrac * range;
    const valid = range >= CFG.minRange;

    // count a step when the signal crosses up through hi;
    // re-arm only after it drops back below lo
    let step = false;
    if (valid) {
      if (!this.above && v > hi) {
        this.above = true;
        const last = this.stepTimes[this.stepTimes.length - 1];
        if (last === undefined || t - last >= CFG.minStepGapMs) {
          this.stepTimes.push(t);
          if (this.stepTimes.length > 50) this.stepTimes.shift();
          this.stepCount++;
          step = true;
        }
      } else if (this.above && v < lo) {
        this.above = false;
      }
    }
    return { sample: { t, v, hi, lo, valid }, step };
  }

  // most recent step gaps in ms, newest first
  // stops at a pause (> 2 s)
  gaps(n = CFG.cadenceGaps): number[] {
    const g: number[] = [];
    for (let i = this.stepTimes.length - 1; i > 0 && g.length < n; i--) {
      const d = this.stepTimes[i] - this.stepTimes[i - 1];
      if (d > 2000) break;
      g.push(d);
    }
    return g;
  }

  // steps per minute, or null if there aren't enough recent steps
  cadence(now: number): number | null {
    const last = this.stepTimes[this.stepTimes.length - 1];
    if (last === undefined || now - last > 2000) return null;
    const g = this.gaps();
    if (g.length < 3) return null;
    return 60000 / median(g);
  }

  // nbeat-lock rule: spread of last 7 gaps (fastest + slowest dropped) < 35% of median
  steadiness(): { steady: boolean; spread: number | null } {
    const g = this.gaps();
    if (g.length < CFG.cadenceGaps) return { steady: false, spread: null };
    const s = [...g].sort((a, b) => a - b).slice(1, -1);
    const spread = (s[s.length - 1] - s[0]) / median(g);
    return { steady: spread < CFG.steadySpread, spread };
  }
}

// vertical gap between highest and lowest foot point, divided by leg length
// doesn't care which foot is left or right (side-view can't break)
function footGap(lm: NormalizedLandmark[]): number | null {
  if ((lm[27]?.visibility ?? 0) < CFG.minAnkleVis || (lm[28]?.visibility ?? 0) < CFG.minAnkleVis) return null;
  let top = Infinity, bottom = -Infinity;
  for (const i of FOOT) { const y = lm[i].y; if (y < top) top = y; if (y > bottom) bottom = y; }
  const hipY = (lm[23].y + lm[24].y) / 2;
  const ankleY = (lm[27].y + lm[28].y) / 2;
  const leg = Math.abs(ankleY - hipY);
  if (leg < 0.05) return null;
  return (bottom - top) / leg;
}

export function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// per-person model: two tiny models trained live in the browser
// 1. follow rate: how much your cadence moves when the tempo moves (one-number regression)
// 2. slip risk: chance your form drops below the slip line soon (small logistic classifier)
// small on-device model, not clinical ai
import { TEMPO } from "./tempo";

export const MODEL = {
  settleMs: 5000, // how long after a tempo change to measure your response (demo pace)
  horizonMs: 5000, // how far ahead slip risk looks (demo pace)
  minEvents: 2, // tempo changes needed before follow rate is trusted
  minLabels: 10, // examples needed before slip risk is trusted
  lr: 0.1, // how fast the classifier learns
};

// before any data, assume you follow about 70% of a tempo change
// the prior counts about as much as 2 real tempo changes of 5%
const PRIOR_FOLLOW = 0.7;
const PRIOR_WEIGHT = 0.005;

export class PersonModel {
  // follow rate = sum(x*y) / sum(x*x), x = tempo change %, y = cadence change %
  // after each tempo change, wait 5 s, then compare cadence before & after
  private sxy = 0;
  private sxx = 0;
  events = 0;

  // classifier weights: [bias, tempo above start, low form, form dropping]
  // starting guess: higher tempo, lower form and falling form all mean more risk
  private w = [-2, 1, 3, 2];
  labels = 0;
  // every second takes snpashoot of:
  // (1) how far from starting tempo, (2) how low form is, (3) how fast form is falling
  slipRisk: number | null = null;

  private change: { at: number; bpmBefore: number; bpmAfter: number; spmBefore: number } | null = null;
  private pending: { at: number; x: number[] }[] = [];
  private formHist: { t: number; form: number }[] = [];
  private lastSample = -Infinity;

  // follow rate, blended with the prior so it never jumps wildly on little data
  follow(): number {
    return (this.sxy + PRIOR_WEIGHT * PRIOR_FOLLOW) / (this.sxx + PRIOR_WEIGHT);
  }

  get followReady() {
    return this.events >= MODEL.minEvents;
  }

  get slipReady() {
    return this.labels >= MODEL.minLabels;
  }

  // forget the live buffers (call when a session starts or stops)
  // learned numbers (sxy, sxx, w) are kept
  resetBuffers() {
    this.change = null;
    this.pending = [];
    this.formHist = [];
    this.slipRisk = null;
    this.lastSample = -Infinity;
  }

  // call when the controller changes the tempo
  tempoChanged(now: number, bpmBefore: number, bpmAfter: number, spmBefore: number | null) {
    this.change = spmBefore === null ? null : { at: now, bpmBefore, bpmAfter, spmBefore };
  }

  // call every frame while the beat is playing
  update(now: number, spm: number | null, bpm: number, base: number, form: number | null) {
    // 1. follow rate: once the change has settled, see how far your cadence moved
    if (this.change && now - this.change.at >= MODEL.settleMs && spm !== null) {
      const c = this.change;
      const x = (c.bpmAfter - c.bpmBefore) / c.bpmBefore;
      // clamp so one weird reading can't wreck the estimate
      const y = clamp((spm - c.spmBefore) / c.spmBefore, -0.3, 0.3);
      this.sxy += x * y;
      this.sxx += x * x;
      this.events++;
      this.change = null;
    }

    if (form === null) return;

    // remember form for the last few seconds to see if it's falling
    this.formHist.push({ t: now, form });
    while (this.formHist.length && this.formHist[0].t < now - 5000) this.formHist.shift();
    const drop = clamp((this.formHist[0].form - form) / 50, -1, 1);

    // features: [bias, tempo above start, low form, form dropping]
    const x = [1, (bpm / base - 1) * 10, (100 - form) / 100, drop];
    // turns inputs into 0-100% chance
    this.slipRisk = sigmoid(dot(this.w, x));

    // one training example per second
    if (now - this.lastSample >= 1000) {
      this.lastSample = now;
      this.pending.push({ at: now, x });
    }

    // 2. slip risk: once enough time has passed, we know if form actually slipped
    // learn from it with one step of gradient descent
    // checks whether form actually slipped below 65 & nudges weights toward the right answer
    while (this.pending.length && now - this.pending[0].at >= MODEL.horizonMs) {
      const ex = this.pending.shift()!;
      const label = form < TEMPO.formSlip ? 1 : 0;
      const err = label - sigmoid(dot(this.w, ex.x));
      // capped influence rule
      this.w = this.w.map((wi, i) => clamp(wi + MODEL.lr * err * ex.x[i], -6, 6));
      this.labels++;
    }
  }
}

function dot(a: number[], b: number[]) {
  return a.reduce((s, ai, i) => s + ai * b[i], 0);
}
function sigmoid(z: number) {
  return 1 / (1 + Math.exp(-z));
}
function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}
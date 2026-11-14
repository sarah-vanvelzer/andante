// per-person model: two tiny models trained live in the browser
// 1. follow rate: how much your cadence moves when the tempo moves (one-number regression)
// 2. slip risk: chance your form drops below the slip line soon (small logistic classifier)
// small on-device model, not clinical ai
import { TEMPO } from "./tempo";
type Saved = { sxy: number; sxx: number; events: number; w: number[]; labels: number };

export const MODEL = {
  settleMs: 5000, // how long after a tempo change to measure your response (demo pace)
  horizonMs: 5000, // how far ahead slip risk looks (demo pace)
  minEvents: 2, // tempo changes needed before follow rate is trusted
  minLabels: 10, // examples needed before slip risk is trusted
  lr: 0.1, // how fast the classifier learns
  holdRisk: 0.5, // slip risk above this = hold instead of speeding up
};

const KEY = "andante.model";
// cap how much past sessions count, so today can still change the estimate
// 0.02 is about 8 tempo changes of 5%
const MAX_PAST_SXX = 0.02;

// before any data, assume you follow about 70% of a tempo change
// the prior counts about as much as 2 real tempo changes of 5%
const PRIOR_FOLLOW = 0.7;
const PRIOR_WEIGHT = 0.005;

export class PersonModel {
  // follow rate = weighted average of (cadence change % / tempo change %), bigger changes count more
  private sxy = 0;
  private sxx = 0;
  events = 0;

  // classifier weights: [bias, tempo above start, low form, form dropping]
  // starting guess: higher tempo, lower form and falling form all mean more risk
  private w = [-2, 1, 3, 2];
  labels = 0;
  slipRisk: number | null = null;

  private change: { at: number; bpmBefore: number; bpmAfter: number; spmBefore: number } | null = null;
  // last 10 s of quick cadence readings, so before/after use a median (one bad step can't spike it)
  private cadHist: { t: number; spm: number }[] = [];
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
    this.cadHist = [];
    this.pending = [];
    this.formHist = [];
    this.slipRisk = null;
    this.lastSample = -Infinity;
  }

  // how big the next speed-up should be
  // you follow well (80%+) = full 5%, you lag (40% or less) = gentler 3%
  // until the model has enough data, use the rule-based 5%
  raiseStep(): number {
    if (!this.followReady) return TEMPO.raise;
    return 0.03 + 0.02 * clamp((this.follow() - 0.4) / 0.4, 0, 1);
  }

  // true when the classifier thinks your form is about to slip
  // turns on above 50%, only turns off below 40%, so it doesn't flicker
  private predicted = false;
  slipPredicted(): boolean {
    if (!this.slipReady || this.slipRisk === null) return (this.predicted = false);
    if (this.slipRisk > MODEL.holdRisk) this.predicted = true;
    else if (this.slipRisk < MODEL.holdRisk - 0.1) this.predicted = false;
    return this.predicted;
  }

  // what the model thinks your slip risk is at a tempo above your start, with good form
  // tempoAbove: 0.1 = 10% above where it locked
  riskAt(tempoAbove: number): number {
    return sigmoid(dot(this.w, [1, tempoAbove * 10, 0.1, 0]));
  }

  // warm start: load what was learned in past sessions
  load() {
    try {
      const d: Saved | null = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (!d) return;
      // scale old evidence down if there's a lot of it, keeping the same follow rate
      const k = d.sxx > MAX_PAST_SXX ? MAX_PAST_SXX / d.sxx : 1;
      this.sxy = d.sxy * k;
      this.sxx = d.sxx * k;
      this.events = d.events;
      this.w = d.w;
      this.labels = d.labels;
    } catch {
      // bad or missing data: start fresh
    }
  }

  // call when a session ends
  save() {
    const d: Saved = { sxy: this.sxy, sxx: this.sxx, events: this.events, w: this.w, labels: this.labels };
    localStorage.setItem(KEY, JSON.stringify(d));
  }

  // call when the controller changes the tempo
  tempoChanged(now: number, bpmBefore: number, bpmAfter: number) {
    // only learn from speed-ups
    // ease-offs happen while form is slipping, when cadence readings are messy
    if (bpmAfter <= bpmBefore) {
      this.change = null;
      return;
    }
    const spmBefore = this.recentCadence(now);
    this.change = spmBefore === null ? null : { at: now, bpmBefore, bpmAfter, spmBefore };
  }

  // median of the last 3 s of cadence readings, or null if there aren't enough
  private recentCadence(now: number): number | null {
    const xs = this.cadHist.filter((h) => h.t >= now - 3000).map((h) => h.spm);
    if (xs.length < 3) return null;
    xs.sort((a, b) => a - b);
    return xs[xs.length >> 1];
  }

  // call every frame while the beat is playing
  update(now: number, spm: number | null, bpm: number, base: number, form: number | null) {
    if (spm !== null) this.cadHist.push({ t: now, spm });
    while (this.cadHist.length && this.cadHist[0].t < now - 10000) this.cadHist.shift();

    // 1. follow rate: once the change has settled, see how far your cadence moved
    if (this.change && now - this.change.at >= MODEL.settleMs) {
      const c = this.change;
      const spmAfter = this.recentCadence(now);
      this.change = null;
      if (spmAfter !== null) {
        const x = (c.bpmAfter - c.bpmBefore) / c.bpmBefore;
        const y = (spmAfter - c.spmBefore) / c.spmBefore;
        // how much of the tempo change you followed: 0 = not at all, 1 = fully
        // capped to 0..1.5 so one noisy reading can't wreck the estimate
        const r = clamp(y / x, 0, 1.5);
        this.sxy += x * x * r;
        this.sxx += x * x;
        this.events++;
      }
    }

    if (form === null) return;

    // remember form for the last few seconds to see if it's falling
    this.formHist.push({ t: now, form });
    while (this.formHist.length && this.formHist[0].t < now - 5000) this.formHist.shift();
    const drop = clamp((this.formHist[0].form - form) / 50, -1, 1);

    // features: [bias, tempo above start, low form, form dropping]
    const x = [1, (bpm / base - 1) * 10, (100 - form) / 100, drop];
    this.slipRisk = sigmoid(dot(this.w, x));

    // one training example per second
    if (now - this.lastSample >= 1000) {
      this.lastSample = now;
      this.pending.push({ at: now, x });
    }

    // 2. slip risk: once enough time has passed, we know if form actually slipped
    // learn from it with one step of gradient descent
    while (this.pending.length && now - this.pending[0].at >= MODEL.horizonMs) {
      const ex = this.pending.shift()!;
      const label = form < TEMPO.formSlip ? 1 : 0;
      const err = label - sigmoid(dot(this.w, ex.x));
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
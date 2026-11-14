// records one andante session and saves it in the browser
// only numbers are kept, never video

// one snpashot per second
// in 2 min demo, ~120
// in 30 min session, ~1,800
export type Sample = {
  t: number; // seconds since the beat locked
  spm: number | null; // your cadence
  bpm: number; // the beat's tempo
  form: number | null; // form score 0-100
  state: string; // what the tempo controller was doing
};

// entire session: samples + summary numbers
export type Session = {
  id: string; // start time as an iso string (date & time)
  demo: boolean;
  durationS: number;
  startBpm: number; // where the beat locked (your natural pace)
  endBpm: number;
  peakBpm: number;
  avgSpm: number | null;
  avgForm: number | null;
  followPct: number | null; // % of time your cadence was within 8% of the beat
  carryovers: number[]; // each carryover result as a fraction (1.0 = held perfectly)
  model: ModelSummary | null; // what the per-person model had learned by the end
  samples: Sample[]; // one per second
};

// what the on-device model learned, passed to the coach
export type ModelSummary = {
  followPct: number | null; // % of each speed-up you followed (null = not enough data yet)
  tempoChanges: number; // speed-ups it has learned from, all sessions
  riskAtStart: number; // predicted slip risk at your starting tempo, good form (%)
  riskAtPlus10: number; // predicted slip risk 10% above your starting tempo, good form (%)
  slipPredictedSec: number; // seconds it held early because it predicted a slip
};

const KEY = "andante.sessions";

// starts when beat locks
// takes one sample per second & collects carryover results
// works out summary when finish() is called
// skips sessions under 5 s
export class SessionRecorder {
  private start: number | null = null;
  private demo = true;
  private lastSample = -Infinity;
  private samples: Sample[] = [];
  private carryovers: number[] = [];

  get active() {
    return this.start !== null;
  }

  // call when the beat locks
  begin(now: number, demo: boolean) {
    this.start = now;
    this.demo = demo;
    this.lastSample = -Infinity;
    this.samples = [];
    this.carryovers = [];
  }

  // call every frame, keeps one sample per second
  record(now: number, spm: number | null, bpm: number, form: number | null, state: string) {
    if (this.start === null || now - this.lastSample < 1000) return;
    this.lastSample = now;
    this.samples.push({ t: Math.round((now - this.start) / 1000), spm, bpm, form, state });
  }

  addCarryover(held: number) {
    this.carryovers.push(held);
  }

  // call when andante stops, returns the finished session (or null if too short)
  finish(now: number, model: Omit<ModelSummary, "slipPredictedSec"> | null = null): Session | null {
    if (this.start === null) return null;
    const s = this.samples;
    const start = this.start;
    this.start = null;
    if (s.length < 5) return null;

    const spms = s.map((x) => x.spm).filter((x): x is number => x !== null);
    const forms = s.map((x) => x.form).filter((x): x is number => x !== null);
    const withSpm = s.filter((x) => x.spm !== null);
    const following = withSpm.filter((x) => Math.abs(x.spm! - x.bpm) / x.bpm < 0.08);

    return {
      id: new Date(Date.now() - (now - start)).toISOString(),
      demo: this.demo,
      durationS: Math.round((now - start) / 1000),
      startBpm: round1(s[0].bpm),
      endBpm: round1(s[s.length - 1].bpm),
      peakBpm: round1(Math.max(...s.map((x) => x.bpm))),
      avgSpm: spms.length ? round1(avg(spms)) : null,
      avgForm: forms.length ? Math.round(avg(forms)) : null,
      followPct: withSpm.length ? Math.round((100 * following.length) / withSpm.length) : null,
      carryovers: this.carryovers.map(round2),
      model: model && { ...model, slipPredictedSec: s.filter((x) => x.state === "holding (slip predicted)").length },
      samples: s,
    };
  }
}

// saved in localStorage: stays on device
export function loadSessions(): Session[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveSession(session: Session) {
  const all = loadSessions();
  all.push(session);
  localStorage.setItem(KEY, JSON.stringify(all));
}

function avg(a: number[]) {
  return a.reduce((x, y) => x + y, 0) / a.length;
}
function round1(x: number) {
  return Math.round(x * 10) / 10;
}
function round2(x: number) {
  return Math.round(x * 100) / 100;
}
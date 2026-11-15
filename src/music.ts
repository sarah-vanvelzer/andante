// music layers on top of the kick (the kick itself stays in beat.ts)
// workout style: driving hats, pumping bass, clap on 2 and 4, off-beat synth stabs
// everything runs on the same tone.js clock as the kick, so it follows the tempo
// layers thin out when form slips and build back in when you recover
import * as Tone from "tone";

// anthemic pop/edm loop: Am · F · C · G, one chord per bar (4 steps)
const CHORDS = [
  ["A3", "C4", "E4"],
  ["F3", "A3", "C4"],
  ["C4", "E4", "G4"],
  ["G3", "B3", "D4"],
];
const ROOTS = ["A1", "F1", "C2", "G1"];

// how loud each layer is when it's on (decibels), and "off"
const ON = { hat: -26, clap: -18, bass: -14, stab: -19 };
const OFF = -60;

// 0 = silent (carryover), 1 = hats only, 2 = + bass and clap, 3 = + synth stabs (full)
export type MusicLevel = 0 | 1 | 2 | 3;

export class Music {
  private transport = Tone.getTransport();
  private ids: number[] = [];
  private level: MusicLevel = 0;

  // one volume knob per layer, so each can fade on its own
  private hatVol = new Tone.Volume(OFF).toDestination();
  private clapVol = new Tone.Volume(OFF).toDestination();
  private bassVol = new Tone.Volume(OFF).toDestination();
  private stabVol = new Tone.Volume(OFF).toDestination();

  // crisp closed hi-hat
  private hat = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.035, sustain: 0 },
  }).connect(new Tone.Filter(8000, "highpass").connect(this.hatVol));

  // clap: a short burst of filtered noise
  private clap = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: { attack: 0.001, decay: 0.14, sustain: 0 },
  }).connect(new Tone.Filter(1600, "bandpass").connect(new Tone.Reverb({ decay: 0.8, wet: 0.25 }).connect(this.clapVol)));

  // punchy saw bass
  private bass = new Tone.MonoSynth({
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.005, decay: 0.15, sustain: 0.2, release: 0.1 },
    filterEnvelope: { attack: 0.005, decay: 0.12, sustain: 0.2, baseFrequency: 90, octaves: 2.5 },
  }).connect(this.bassVol);

  // short bright chord stabs
  private stab = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.005, decay: 0.18, sustain: 0.05, release: 0.15 },
  }).connect(new Tone.Filter(2600, "lowpass").connect(new Tone.Reverb({ decay: 1.5, wet: 0.2 }).connect(this.stabVol)));

  get playing() {
    return this.ids.length > 0;
  }

  // call right after the beat starts (same clock)
  start() {
    if (this.playing) return;
    // hats on every 8th note (on the step and halfway between)
    this.ids.push(this.transport.scheduleRepeat((t) => this.hat.triggerAttackRelease("32n", t), "8n"));
    // clap on beats 2 and 4
    this.ids.push(this.transport.scheduleRepeat((t) => this.clap.triggerAttackRelease("16n", t), "2n", "4n"));
    // bass pumps on every 8th note, following the chord
    this.ids.push(this.transport.scheduleRepeat((t) => this.bass.triggerAttackRelease(ROOTS[this.chordAt(t)], "16n", t), "8n"));
    // chord stabs on the off-beat (halfway between steps)
    this.ids.push(this.transport.scheduleRepeat((t) => this.stab.triggerAttackRelease(CHORDS[this.chordAt(t)], "16n", t), "4n", "8n"));
    this.setLevel(3, 0.5);
  }

  // which of the 4 chords is playing at this moment (one per bar)
  private chordAt(time: number) {
    const bars = Math.floor(this.transport.getTicksAtTime(time) / this.transport.PPQ / 4);
    return bars % 4;
  }

  stop() {
    for (const id of this.ids) this.transport.clear(id);
    this.ids = [];
    this.stab.releaseAll();
    this.setLevel(0, 0.3);
  }

  // fade layers in or out (only does work when the level actually changes)
  setLevel(level: MusicLevel, seconds = 1) {
    if (level === this.level) return;
    this.level = level;
    this.hatVol.volume.rampTo(level >= 1 ? ON.hat : OFF, seconds);
    this.clapVol.volume.rampTo(level >= 2 ? ON.clap : OFF, seconds);
    this.bassVol.volume.rampTo(level >= 2 ? ON.bass : OFF, seconds);
    this.stabVol.volume.rampTo(level >= 3 ? ON.stab : OFF, seconds);
  }
}

// which layers to play for each tempo state
export function levelFor(state: string): MusicLevel {
  switch (state) {
    case "easing off":
    case "holding (form low)":
    case "holding (no steps)":
      return 1; // back to basics: kick + hats
    case "holding (slip predicted)":
      return 2; // stabs drop out first
    default:
      return 3; // speeding up, holding, measuring: full music
  }
}
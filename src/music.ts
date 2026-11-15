// music layers on top of the kick (the kick itself stays in beat.ts)
// club style: four-on-the-floor kick (beat.ts), off-beat open hats, clap on 2 and 4,
// rolling off-beat bass, pumping supersaw chords and a rave-y arp
// everything runs on the same tone.js clock as the kick, so it follows the tempo
// layers thin out when form slips and build back in when you recover
import * as Tone from "tone";

// emotional festival loop: Dm · Bb · F · C, one chord per bar (4 steps)
const CHORDS = [
  ["D4", "F4", "A4"],
  ["Bb3", "D4", "F4"],
  ["F3", "A3", "C4"],
  ["C4", "E4", "G4"],
];
const ROOTS = ["D2", "Bb1", "F1", "C2"];

// how loud each layer is when it's on (decibels), and "off"
const ON = { hat: -24, clap: -16, bass: -12, chords: -22, arp: -26 };
const OFF = -60;

// 0 = silent (carryover), 1 = hats only, 2 = + clap and bass, 3 = + chords and arp (full drop)
export type MusicLevel = 0 | 1 | 2 | 3;

export class Music {
  private transport = Tone.getTransport();
  private ids: number[] = [];
  private level: MusicLevel = 0;

  // one volume knob per layer, so each can fade on its own
  private hatVol = new Tone.Volume(OFF).toDestination();
  private clapVol = new Tone.Volume(OFF).toDestination();
  private bassVol = new Tone.Volume(OFF).toDestination();
  private chordVol = new Tone.Volume(OFF).toDestination();
  private arpVol = new Tone.Volume(OFF).toDestination();

  // the "pump": chords duck on every kick and swell back up (sidechain feel)
  private pump = new Tone.Gain(1).connect(new Tone.Reverb({ decay: 2.5, wet: 0.3 }).connect(this.chordVol));

  // open hat on the off-beat, the classic house "tss"
  private hat = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.002, decay: 0.12, sustain: 0 },
  }).connect(new Tone.Filter(7500, "highpass").connect(this.hatVol));

  // tight clap with a little room
  private clap = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: { attack: 0.001, decay: 0.16, sustain: 0 },
  }).connect(new Tone.Filter(1500, "bandpass").connect(new Tone.Reverb({ decay: 1, wet: 0.3 }).connect(this.clapVol)));

  // round, punchy bass on the off-beats (between kicks)
  private bass = new Tone.MonoSynth({
    oscillator: { type: "square" },
    envelope: { attack: 0.005, decay: 0.2, sustain: 0.3, release: 0.08 },
    filterEnvelope: { attack: 0.005, decay: 0.15, sustain: 0.3, baseFrequency: 110, octaves: 2.2 },
  }).connect(this.bassVol);

  // wide supersaw chords, held for the bar and pumped by the kick
  private chords = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "fatsawtooth", count: 3, spread: 30 },
    envelope: { attack: 0.02, decay: 0.3, sustain: 0.7, release: 0.4 },
  }).connect(new Tone.Filter(3200, "lowpass").connect(this.pump));

  // bright plucky arp running through the chord notes
  private arp = new Tone.Synth({
    oscillator: { type: "square" },
    envelope: { attack: 0.002, decay: 0.09, sustain: 0, release: 0.05 },
  }).connect(new Tone.FeedbackDelay("8n.", 0.25).connect(new Tone.Filter(4000, "lowpass").connect(this.arpVol)));

  get playing() {
    return this.ids.length > 0;
  }

  // call right after the beat starts (same clock)
  start() {
    if (this.playing) return;
    const add = (cb: (t: number) => void, every: string, offset: string = "0") =>
      this.ids.push(this.transport.scheduleRepeat(cb, every, offset));

    // open hat on every off-beat
    add((t) => this.hat.triggerAttackRelease("16n", t), "4n", "8n");
    // clap on beats 2 and 4
    add((t) => this.clap.triggerAttackRelease("16n", t), "2n", "4n");
    // bass on every off-beat, jumping up an octave on the last one of the bar
    add((t) => {
      const root = Tone.Frequency(ROOTS[this.chordAt(t)]);
      const note = this.beatInBar(t) === 3 ? root.transpose(12) : root;
      this.bass.triggerAttackRelease(note.toNote(), "16n", t);
    }, "4n", "8n");
    // new chord every bar
    add((t) => this.chords.triggerAttackRelease(CHORDS[this.chordAt(t)], "1m", t), "1m");
    // pump: duck the chords on every kick, swell back up before the next one
    add((t) => {
      const beat = Tone.Time("4n").toSeconds();
      this.pump.gain.cancelScheduledValues(t);
      this.pump.gain.setValueAtTime(0.2, t);
      this.pump.gain.linearRampToValueAtTime(1, t + beat * 0.75);
    }, "4n");
    // arp: 16th notes up and down the chord, an octave up
    let i = 0;
    add((t) => {
      const notes = CHORDS[this.chordAt(t)];
      const pattern = [0, 1, 2, 1];
      const note = Tone.Frequency(notes[pattern[i++ % 4]]).transpose(12).toNote();
      this.arp.triggerAttackRelease(note, "32n", t);
    }, "16n");

    this.setLevel(3, 0.5);
  }

  // which of the 4 chords is playing at this moment (one per bar)
  private chordAt(time: number) {
    return Math.floor(this.transport.getTicksAtTime(time) / this.transport.PPQ / 4) % 4;
  }

  // which step of the bar (0-3) this moment falls in
  private beatInBar(time: number) {
    return Math.floor(this.transport.getTicksAtTime(time) / this.transport.PPQ) % 4;
  }

  stop() {
    for (const id of this.ids) this.transport.clear(id);
    this.ids = [];
    this.chords.releaseAll();
    this.setLevel(0, 0.3);
  }

  // fade layers in or out (only does work when the level actually changes)
  setLevel(level: MusicLevel, seconds = 1) {
    if (level === this.level) return;
    this.level = level;
    this.hatVol.volume.rampTo(level >= 1 ? ON.hat : OFF, seconds);
    this.clapVol.volume.rampTo(level >= 2 ? ON.clap : OFF, seconds);
    this.bassVol.volume.rampTo(level >= 2 ? ON.bass : OFF, seconds);
    this.chordVol.volume.rampTo(level >= 3 ? ON.chords : OFF, seconds);
    this.arpVol.volume.rampTo(level >= 3 ? ON.arp : OFF, seconds);
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
      return 2; // the chords and arp drop out first
    default:
      return 3; // speeding up, holding, measuring: the full drop
  }
}
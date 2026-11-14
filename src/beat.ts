// steady click on Tone.js's own audio clock
// the beat is scheduled slightly ahead, so it stays perfectly steady even when pose detection is busy
// cadence only nudges the tempo
import * as Tone from "tone";

export class Beat {
    // generates short "thock" in code, so no audio files / licensing
    private synth = new Tone.MembraneSynth({
        pitchDecay: 0.01,
        octaves: 4,
        envelope: { attack: 0.001, decay: 0.12, sustain: 0 },
    }).toDestination();
    private loopId: number | null = null;
    private transport = Tone.getTransport();

    get bpm() { return this.transport.bpm.value; }
    get playing() { return this.loopId !== null; }

    // must be called from a click: browsers only allow audio after a user action
    // creates beat
    async start(bpm: number) {
        await Tone.start();
        this.transport.bpm.value = bpm;
        // one click per quarter note = one click per step
        this.loopId = this.transport.scheduleRepeat((time) => {
            this.synth.triggerAttackRelease("C2", "32n", time);
        }, "4n");
        this.transport.start();
    }

    stop() {
        if (this.loopId !== null) this.transport.clear(this.loopId);
        this.loopId = null;
        this.transport.stop();
    }

    // smoothly glide to a new tempo over seconds
    setBpm(bpm: number, seconds = 1) {
        // glide instead of jumping
        this.transport.bpm.rampTo(bpm, seconds);
    }
}
// rule-based tempo controller
// raises the tempo ~5% at a time while you're keeping up with the beat
// form check comes in block 3

export const TEMPO = {
    stepEveryMs: 10000, // time between tempo changes (demo pace, real mode will be ~30 s)
    raise: 0.05, // raise by 5% each time
    followTol: 0.08, // "keeping up" = your cadence within 8% of the beat
    maxAboveBase: 0.15, // never go more than 15% above where it locked
};

export class TempoController {
    // base = tempo you locked at (natural pace)
    // 15% ceiling measured from here
    base: number | null = null;
    private lastChange = 0;

    // call when the beat first locks on
    // records starting tempo & starts 10 second timer
    lock(bpm: number, now: number) {
        this.base = bpm;
        this.lastChange = now;
    }

    reset() {
        this.base = null;
    }

    // returns a new bpm to glide to, or null to hold the current tempo
    // returns null (hold) unless 10 seconds have passed, keeping up, & under ceiling
    // returns new tempo 5% higher
    update(now: number, bpm: number, spm: number | null): number | null {
        if (this.base === null || spm === null) return null;
        if (now - this.lastChange < TEMPO.stepEveryMs) return null;

        // only speed up if you're actually following the beat
        const following = Math.abs(spm - bpm) / bpm < TEMPO.followTol;
        if (!following) return null;

        // stop at the ceiling
        const ceiling = this.base * (1 + TEMPO.maxAboveBase);
        if (bpm >= ceiling - 0.5) return null;

        this.lastChange = now;
        return Math.min(bpm * (1 + TEMPO.raise), ceiling);
    }
}
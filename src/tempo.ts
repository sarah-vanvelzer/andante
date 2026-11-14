// rule-based tempo controller
// raises the tempo ~5% at a time while you're keeping up with the beat
// eases off when your form slips

export const TEMPO = {
    stepEveryMs: 10000, // time between tempo changes (demo pace, real mode will be ~30 s)
    raise: 0.05, // raise by 5% each time
    followTol: 0.1, // "keeping up" = your cadence within 8% of the beat
    maxAboveBase: 0.15, // never go more than 15% above where it locked
    formGood: 80, // form at or above this = ok to speed up
    formSlip: 65, // form below this = ease off
    easeEveryMs: 4000, // time between ease-off steps
    ease: 0.03, // slow down 3% each time
};

export class TempoController {
    // base = tempo you locked at (natural pace)
    // 15% ceiling measured from here
    base: number | null = null;
    private lastChange = 0;
    state = "";

    // call when the beat first locks on
    // records starting tempo & starts 10 second timer
    lock(bpm: number, now: number) {
        this.base = bpm;
        this.lastChange = now;
    }

    reset() {
        this.base = null;
        this.state = "";
    }

    // returns a new bpm to glide to, or null to hold the current tempo
    // form is null while the baseline is still being measured
    update(now: number, bpm: number, spm: number | null, form: number | null): number | null {
        if (this.base === null) return null;
        const since = now - this.lastChange;

        // still measuring your normal form: wait
        if (form === null) {
            this.state = "measuring";
            return null;
        }

        // form slipped: ease off, but never below where it locked
        if (form < TEMPO.formSlip) {
            if (bpm <= this.base + 0.5) {
                this.state = "holding (form low)";
                return null;
            }
            this.state = "easing off";
            if (since < TEMPO.easeEveryMs) return null;
            this.lastChange = now;
            return Math.max(bpm * (1 - TEMPO.ease), this.base);
        }

        // form in the middle zone: hold
        if (form < TEMPO.formGood) {
            this.state = "holding";
            return null;
        }

        // no recent steps: can't tell if you're keeping up, so hold
        if (spm === null) {
            this.state = "holding (no steps)";
            return null;
        }

        // only speed up if you're actually following the beat
        const following = Math.abs(spm - bpm) / bpm < TEMPO.followTol;
        const ceiling = this.base * (1 + TEMPO.maxAboveBase);
        if (!following) {
            this.state = "holding (off beat)";
            return null;
        }
        if (bpm >= ceiling - 0.5) {
            this.state = "holding (at max)";
            return null;
        }

        this.state = "speeding up";
        if (since < TEMPO.stepEveryMs) return null;
        this.lastChange = now;
        return Math.min(bpm * (1 + TEMPO.raise), ceiling);
    }
}
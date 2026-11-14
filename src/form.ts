// form score from 2 simple signals, compared with your own baseline
// trunk lean: shoulders vs hips angle from vertical (slouching = more lean)
// knee lift: how much your feet are moving, as % of your baseline
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { median } from "./steps";

export const FORM = {
    baselineMs: 8000, // how long to measure your normal form (demo pace)
    leanFree: 3, // degrees of extra lean before it costs anything
    leanZero: 13, // degrees of extra lean that gives a lean score of 0
    liftOk: 0.85, // lift at 85%+ of baseline = full marks
    liftZero: 0.5, // lift at 50% of baseline = 0
    liftWindowMs: 2500, // knee lift looks at the last 2.5 s of movement
};

export class FormTracker {
    private baseStart: number | null = null;
    private baseLeans: number[] = [];
    private baseLifts: number[] = [];
    baseLean: number | null = null;
    baseLift: number | null = null;

    lean: number | null = null;
    lift: number | null = null;
    private hist: { t: number; v: number }[] = [];

    // call when the beat locks on
    startBaseline(now: number) {
        this.baseStart = now;
        this.baseLeans = [];
        this.baseLifts = [];
        this.baseLean = null;
        this.baseLift = null;
    }

    // call when andante stops
    // clears your baseline so the next start measures fresh
    reset() {
        this.baseStart = null;
        this.baseLeans = [];
        this.baseLifts = [];
        this.baseLean = null;
        this.baseLift = null;
    }

    get calibrating() {
        return this.baseStart !== null && this.baseLean === null;
    }

    // every frame
    update(lm: NormalizedLandmark[] | undefined, aspect: number, v: number | null, now: number) {
        // trunk lean, smoothed
        if (lm) {
            const a = trunkLean(lm, aspect);
            this.lean = this.lean === null ? a : 0.1 * a + 0.9 * this.lean;
        }

        // knee lift = how far the foot-gap line moves (low to high) over the last 2.5 s
        // updates every frame, so it drops right away when you stop lifting
        // even if no steps are being counted
        if (v !== null) this.hist.push({ t: now, v });
        while (this.hist.length && this.hist[0].t < now - FORM.liftWindowMs) this.hist.shift();
        if (this.hist.length > 5) {
            let lo = Infinity, hi = -Infinity;
            for (const h of this.hist) { if (h.v < lo) lo = h.v; if (h.v > hi) hi = h.v; }
            this.lift = hi - lo;
            if (this.calibrating) this.baseLifts.push(this.lift);
        } else {
            this.lift = null;
        }

        // collect baseline, then lock it in
        if (this.calibrating && this.lean !== null) {
            this.baseLeans.push(this.lean);
            if (now - this.baseStart! > FORM.baselineMs && this.baseLifts.length > 0) {
                this.baseLean = median(this.baseLeans);
                this.baseLift = median(this.baseLifts);
            }
        }
    }

    // extra lean vs baseline in degrees
    leanDelta(): number | null {
        if (this.lean === null || this.baseLean === null) return null;
        return this.lean - this.baseLean;
    }

    // current lift as a fraction of baseline
    liftRatio(): number | null {
        if (this.baseLift === null || this.lift === null || this.baseLift <= 0) return null;
        return this.lift / this.baseLift;
    }

    // 0 to 100, or null while calibrating
    score(): number | null {
        const d = this.leanDelta();
        const r = this.liftRatio();
        if (d === null || r === null) return null;
        const leanScore = clamp01(1 - (d - FORM.leanFree) / (FORM.leanZero - FORM.leanFree));
        const liftScore = clamp01((r - FORM.liftZero) / (FORM.liftOk - FORM.liftZero));
        // form is only as good as the weaker signal
        // so good posture can't hide dragging feet (and the other way round)
        return Math.round(100 * Math.min(leanScore, liftScore));
    }
}

// angle of the hip-to-shoulder line from vertical, in degrees
// x is scaled by the video's aspect ratio so the angle is real
function trunkLean(lm: NormalizedLandmark[], aspect: number): number {
    const sx = (lm[11].x + lm[12].x) / 2, sy = (lm[11].y + lm[12].y) / 2;
    const hx = (lm[23].x + lm[24].x) / 2, hy = (lm[23].y + lm[24].y) / 2;
    const dx = Math.abs(sx - hx) * aspect;
    const dy = Math.abs(hy - sy);
    return (Math.atan2(dx, dy) * 180) / Math.PI;
}

function clamp01(x: number) {
    return Math.max(0, Math.min(1, x));
}
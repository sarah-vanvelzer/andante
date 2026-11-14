// form score from 2 simple signals, compared with your own baseline
// trunk lean: shoulders vs. hips angle from vertical (slouching = more lean)
// knee lift: how high each step lifts, as % of your baseline lift
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { median } from "./steps";

export const FORM = {
    baselineMs: 8000, // how long to measure your normal form (demo pace)
    leanFree: 3, // degrees of extra lean before it costs anything
    leanZero: 13, // degrees of extra lean that gives a lean score of 0
    liftOk: 0.85, // lift at 85%+ of baseline = full marks
    liftZero: 0.5, // lift at 50% of baseline = 0
    liftSteps: 4, // knee lift uses the last 4 steps
};

export class FormTracker {
    private baseStart: number | null = null;
    private baseLeans: number[] = [];
    private baseLifts: number[] = [];
    baseLean: number | null = null;
    baseLift: number | null = null;

    lean: number | null = null;
    private lifts: number[] = [];
    private peak = -Infinity;
    private low = Infinity;

    // call when andante starts
    startBaseline(now: number) {
        this.baseStart = now;
        this.baseLeans = [];
        this.baseLifts = [];
        this.baseLean = null;
        this.baseLift = null;
        this.lifts = [];
    }

    get calibrating() {
        return this.baseStart !== null && this.baseLean === null;
    }

    // every frame
    update(lm: NormalizedLandmark[] | undefined, aspect: number, v: number | null, step: boolean, now: number) {
        // trunk lean, smoothed
        if (lm) {
            const a = trunkLean(lm, aspect);
            this.lean = this.lean === null ? a : 0.1 * a + 0.9 * this.lean;
        }

        // knee lift = how far the foot-gap rises from its low point to its high point between two steps
        // measuring rise (not raw height) removes the resting gap between ankle and toe
        if (v !== null) {
            this.peak = Math.max(this.peak, v);
            this.low = Math.min(this.low, v);
        }
        if (step) {
            const rise = this.peak - this.low;
            if (Number.isFinite(rise) && rise > 0) {
                this.lifts.push(rise);
                if (this.lifts.length > FORM.liftSteps) this.lifts.shift();
                if (this.calibrating) this.baseLifts.push(rise);
            }
            this.peak = -Infinity;
            this.low = Infinity;
        }

        // collect baseline, then lock it in
        if (this.calibrating && this.lean !== null) {
            this.baseLeans.push(this.lean);
            if (now - this.baseStart! > FORM.baselineMs && this.baseLifts.length >= 3) {
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

    // recent lift as a fraction of baseline
    liftRatio(): number | null {
        if (this.baseLift === null || this.lifts.length === 0) return null;
        return median(this.lifts) / this.baseLift;
    }

    // 0 to 100, or null while calibrating
    score(): number | null {
        const d = this.leanDelta();
        const r = this.liftRatio();
        if (d === null || r === null) return null;
        const leanScore = clamp01(1 - (d - FORM.leanFree) / (FORM.leanZero - FORM.leanFree));
        const liftScore = clamp01((r - FORM.liftZero) / (FORM.liftOk - FORM.liftZero));
        return Math.round(100 * (0.5 * leanScore + 0.5 * liftScore));
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
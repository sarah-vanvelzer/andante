// debug graph: smoothed foot-gap signal (white), thresholds (red = up, blue = down),
// and an orange line at every counted step
// shows the last 6 secondss
import type { Sample } from "./steps";

const SPAN_MS = 6000;

export class DebugGraph {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private samples: Sample[] = [];
  private steps: number[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
  }

  push(s: Sample) { this.samples.push(s); }
  step(t: number) { this.steps.push(t); }
  clear() { this.samples = []; this.steps = []; }

  draw(now: number) {
    const { canvas: c, ctx } = this;
    const dpr = devicePixelRatio;
    const w = (c.width = c.clientWidth * dpr);
    const h = (c.height = c.clientHeight * dpr);

    // drop anything older than 6 s
    const t0 = now - SPAN_MS;
    this.samples = this.samples.filter((s) => s.t >= t0);
    this.steps = this.steps.filter((t) => t >= t0);

    ctx.fillStyle = "#16181d";
    ctx.fillRect(0, 0, w, h);
    if (!this.samples.length) return;

    // scale the y-axis to the biggest value on screen
    let max = 0.1;
    for (const s of this.samples) max = Math.max(max, s.v, s.hi);
    max *= 1.15;
    const X = (t: number) => ((t - t0) / SPAN_MS) * w;
    const Y = (v: number) => h - (v / max) * h;

    // step markers
    ctx.strokeStyle = "#f5b94a";
    ctx.lineWidth = 2 * dpr;
    for (const t of this.steps) {
      ctx.beginPath(); ctx.moveTo(X(t), 0); ctx.lineTo(X(t), h); ctx.stroke();
    }

    // lines: thresholds dashed, signal solid
    const line = (key: "v" | "hi" | "lo", color: string, dashed: boolean) => {
      ctx.strokeStyle = color;
      ctx.setLineDash(dashed ? [6 * dpr, 4 * dpr] : []);
      ctx.lineWidth = (dashed ? 1.5 : 2.5) * dpr;
      ctx.beginPath();
      this.samples.forEach((s, i) =>
        i ? ctx.lineTo(X(s.t), Y(s[key])) : ctx.moveTo(X(s.t), Y(s[key])),
      );
      ctx.stroke();
    };
    // red line = 60% of distance between highest & lowest white values
    // crossing through red => step
    line("hi", "#e5484d", true);
    // blue line = 35% of distance between highest & lowest white values
    // must drop below blue before next step can count
    line("lo", "#3e9bff", true);
    // white line = vertical distance between feet (scaled by leg length)
    line("v", "#e8e8e8", false);
    ctx.setLineDash([]);
  }
}
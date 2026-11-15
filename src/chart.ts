// line chart for beat vs you, with form as a coloured strip along the bottom
// live mode shows the last 60 s, session mode shows the whole session
export type Point = { t: number; beat: number | null; you: number | null; form: number | null };

const C = { beat: "#e6b800", you: "#29b6c9", grid: "#e2e0da", text: "#6b6862", red: "#ff6464", yellow: "#fcd113", green: "#95da4c" };
const STRIP = 10; // form strip height (css px)
const GAP = 10; // space between the lines and the strip

export class LineChart {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private spanMs: number | null;
  private emptyText: string;
  points: Point[] = [];

  // spanMs = how much time to show (null = everything)
  constructor(canvas: HTMLCanvasElement, spanMs: number | null, emptyText = "") {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.spanMs = spanMs;
    this.emptyText = emptyText;
  }

  push(p: Point) {
    this.points.push(p);
    // keep a little more than we show
    if (this.spanMs !== null) {
      const cutoff = p.t - this.spanMs * 1.2;
      while (this.points.length && this.points[0].t < cutoff) this.points.shift();
    }
  }

  clear() {
    this.points = [];
  }

  draw(now?: number) {
    const { canvas: c, ctx } = this;
    const dpr = devicePixelRatio;
    const w = (c.width = c.clientWidth * dpr);
    const h = (c.height = c.clientHeight * dpr);
    ctx.clearRect(0, 0, w, h);
    ctx.font = `600 ${13 * dpr}px "Lenia Sans", Figtree, sans-serif`;

    // time range
    const tEnd = now ?? (this.points.length ? this.points[this.points.length - 1].t : 0);
    const tStart = this.spanMs !== null ? tEnd - this.spanMs : this.points.length ? this.points[0].t : 0;
    const pts = this.points.filter((p) => p.t >= tStart);

    // tempo range from beat + you, padded so lines don't touch the edges
    const vals = pts.flatMap((p) => [p.beat, p.you]).filter((v): v is number => v !== null);
    if (pts.length < 2 || !vals.length) {
      if (this.emptyText) {
        ctx.fillStyle = C.text;
        ctx.textAlign = "center";
        ctx.fillText(this.emptyText, w / 2, h / 2);
        ctx.textAlign = "start";
      }
      return;
    }
    let lo = Math.min(...vals) - 6;
    let hi = Math.max(...vals) + 6;
    if (hi - lo < 20) { const mid = (hi + lo) / 2; lo = mid - 10; hi = mid + 10; }

    const left = 36 * dpr;
    const plotH = h - (STRIP + GAP) * dpr;
    const X = (t: number) => left + ((t - tStart) / (tEnd - tStart || 1)) * (w - left);
    const Y = (v: number) => plotH - ((v - lo) / (hi - lo)) * plotH;

    // grid lines with tempo labels
    ctx.fillStyle = C.text;
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = dpr;
    for (let i = 1; i <= 3; i++) {
      const v = lo + ((hi - lo) * i) / 4;
      const y = Y(v);
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.fillText(String(Math.round(v)), 0, y + 4 * dpr);
    }

    // form strip: each stretch coloured by its zone (red < 65, yellow 65–79, green 80+)
    const sy = h - STRIP * dpr;
    for (let i = 0; i < pts.length - 1; i++) {
      const f = pts[i].form;
      if (f === null) continue;
      ctx.fillStyle = f < 65 ? C.red : f < 80 ? C.yellow : C.green;
      ctx.fillRect(X(pts[i].t), sy, X(pts[i + 1].t) - X(pts[i].t) + 1, STRIP * dpr);
    }

    // a line that breaks wherever the value is missing (e.g. beat off during carryover)
    const line = (get: (p: Point) => number | null, color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width * dpr;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      let drawing = false;
      for (const p of pts) {
        const v = get(p);
        if (v === null) { drawing = false; continue; }
        if (drawing) ctx.lineTo(X(p.t), Y(v));
        else { ctx.moveTo(X(p.t), Y(v)); drawing = true; }
      }
      ctx.stroke();
    };
    line((p) => p.beat, C.beat, 4);
    line((p) => p.you, C.you, 3);
  }
}
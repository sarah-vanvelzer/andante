// asks the gemini coach (via our own /api/coach) for a report on the latest session
// sends numbers only: summaries of past sessions + a thinned-out timeline of the latest one
import type { Session } from "./session";

export type CoachReport = {
  summary: string;
  wentWell: string[];
  toWorkOn: string[];
  trend: string;
  learned: string;
  nextSession: { startBpm: number; maxBpm: number; minutes: number; focus: string };
};

// sends lates session + summaries of up to 10 past sessions
// gemini comments on TREND
export async function getCoachReport(sessions: Session[]): Promise<CoachReport> {
  const latest = sessions[sessions.length - 1];
  // drop the per-second samples from older sessions to keep the request small
  const history = sessions.slice(0, -1).slice(-10).map(({ samples, ...rest }) => rest);
  // one sample every 5 s is plenty for the coach
  const timeline = latest.samples.filter((_, i) => i % 5 === 0);

  const res = await fetch("/api/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latest: { ...latest, samples: timeline }, history }),
    // give up after 45 s so the demo never hangs
    signal: AbortSignal.timeout(45000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `coach failed (${res.status})`);
  return data as CoachReport;
}

// turns the report into plain text for the summary box
export function formatReport(r: CoachReport): string {
  const list = (xs: string[]) => xs.map((x) => `• ${x}`).join("\n");
  return (
    `Coach report\n${r.summary}\n\n` +
    `Went well\n${list(r.wentWell)}\n\n` +
    `To work on\n${list(r.toWorkOn)}\n\n` +
    `${r.trend}\n\n` +
    `What Andante learned\n${r.learned}\n\n` +
    `Next session: start at ${Math.round(r.nextSession.startBpm)} bpm, up to ${Math.round(r.nextSession.maxBpm)} bpm, ${Math.round(r.nextSession.minutes)} min\n` +
    `Focus: ${r.nextSession.focus}`
  );
}
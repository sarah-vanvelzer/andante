// gemini coach: reads session numbers and writes a physio-style report + next session plan
// runs on the server (vercel function, or the vite dev server locally)
// so the api key never reaches the browser
// only numbers come in here, never video
import type { IncomingMessage, ServerResponse } from "node:http";

// points to google's current flash model (doesn't go stale)
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

// the exact json shape gemini must fill in
const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "2-3 sentences on how this session went, plain language" },
    wentWell: { type: "array", items: { type: "string" }, description: "1-3 short points" },
    toWorkOn: { type: "array", items: { type: "string" }, description: "1-3 short points" },
    trend: { type: "string", description: "1 sentence comparing with past sessions, or say this is the first one" },
    nextSession: {
      type: "object",
      properties: {
        startBpm: { type: "number", description: "starting tempo for next session" },
        maxBpm: { type: "number", description: "highest tempo to allow next session" },
        minutes: { type: "number", description: "session length in minutes, 10 to 40" },
        focus: { type: "string", description: "one thing to focus on" },
      },
      required: ["startBpm", "maxBpm", "minutes", "focus"],
    },
  },
  required: ["summary", "wentWell", "toWorkOn", "trend", "nextSession"],
};

// instructions for gemini
// no medical claims, sessions capped at 40 min, small safe stempo steps, backs off if form was low
const RULES = `You are a supportive walking-rehab coach writing a short report for a patient and their physiotherapist.
You get numbers from a webcam rhythm-cueing app called Andante. Only use these numbers, do not invent data.
How the app works: the beat locks at the patient's own cadence (startBpm), rises about 5% at a time while form holds, and eases off when form drops. Form is 0-100 vs the patient's own baseline (trunk lean + knee lift). followPct = % of time cadence was within 8% of the beat. Carryover = cadence during a short silent gap as a fraction of the beat (1.0 = held perfectly).
Rules:
- You are not a doctor. No diagnoses, no medical claims, no promises about treating any condition.
- Next session: startBpm within 5% of this session's startBpm or endBpm, maxBpm at most 10% above startBpm, minutes between 10 and 40.
- If form or followPct was low, keep the tempo the same or lower rather than pushing.
- Sessions marked demo are short test runs; still give a plan but keep it modest.
- Plain, warm, short language. No jargon.`;

// models to try in order: if the first is overloaded, fall back to the lighter one
const MODELS = [MODEL, "gemini-flash-lite-latest"];

export async function coach(body: unknown): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");

  let lastError = "";
  for (const model of MODELS) {
    // up to 2 tries per model, waiting 1 s then 2 s
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: RULES }] },
          contents: [{ role: "user", parts: [{ text: "Session data:\n" + JSON.stringify(body) }] }],
          generationConfig: { responseMimeType: "application/json", responseJsonSchema: SCHEMA },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
        return JSON.parse(text);
      }

      lastError = `gemini ${res.status} (${model}): ${await res.text()}`;
      // only retry when google is busy (503) or rate limiting (429)
      // anything else (bad key, bad request) won't fix itself
      if (res.status !== 503 && res.status !== 429) throw new Error(lastError);
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error(lastError);
}

// node-style handler: works on vercel and in the vite dev server
// web endpoint (automatically runs any file in api/ as /api/coach)
export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      return res.end("POST only");
    }
    // vercel already parses the body, the vite dev server doesn't
    const body = req.body ?? JSON.parse(await readBody(req));
    const report = await coach(body);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(report));
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
}
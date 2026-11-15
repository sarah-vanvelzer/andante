import "./style.css";
import { DrawingUtils, PoseLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import { createPose } from "./pose";
import { StepDetector, median } from "./steps";
import { Beat } from "./beat";
import { TempoController, TEMPO } from "./tempo";
import { FormTracker, FORM } from "./form";
import { SessionRecorder, saveSession, loadSessions, type Session } from "./session";
import { getCoachReport, type CoachReport } from "./coach";
import { PersonModel, MODEL } from "./model";
import { LineChart } from "./chart";
import { DebugGraph } from "./graph";
import { Music, levelFor } from "./music";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// camera + header
const video = $<HTMLVideoElement>("video");
const overlay = $<HTMLCanvasElement>("overlay");
const statusEl = $("status");
const camPill = $<HTMLButtonElement>("camPill");

// live screen
const liveView = $("liveView");
const bannerEl = $("banner");
const bannerTitle = $("bannerTitle");
const bannerSub = $("bannerSub");
const beatTile = $("beatTile");
const beatEl = $("beat");
const beatSubEl = $("beatSub");
const cadenceEl = $("cadence");
const formEl = $("form");
const formDetailEl = $("formDetail");
const formMarker = $("formMarker");
const followEl = $("follow");
const slipEl = $("slipRisk");
const andanteBtn = $<HTMLButtonElement>("andante");

// report screen
const reportView = $("reportView");

// debug page (debug button in the top bar, or localhost:5173/#debug)
const debugView = $("debugView");
const stepsEl = $("steps");
const dCadenceEl = $("dCadence");
const steadyEl = $("steady");
const leanEl = $("lean");
const liftEl = $("lift");
const tempoStateEl = $("tempoState");
const graph = new DebugGraph($<HTMLCanvasElement>("graph"));
$("reset").addEventListener("click", () => { detector.reset(); graph.clear(); });

// show the debug page when the url ends in #debug, otherwise the normal screens
let reportOpen = false;
function route() {
  const debug = location.hash === "#debug";
  debugView.hidden = !debug;
  liveView.hidden = debug || reportOpen;
  reportView.hidden = debug || !reportOpen;
}
window.addEventListener("hashchange", route);
const newSessionBtn = $<HTMLButtonElement>("newSession");

let carryMs = 8000;
// first carryover runs 35 s after beat locks, then every 45 s
let carryFirstMs = 35000;
let carryEveryMs = 45000;

// demo mode squeezes every timer so a full session fits in ~2 min
// real mode uses session-length timers
const demoBox = $<HTMLInputElement>("demo");
function applyMode() {
  const demo = demoBox.checked;
  FORM.baselineMs = demo ? 5000 : 60000;
  TEMPO.stepEveryMs = demo ? 6000 : 30000;
  TEMPO.easeEveryMs = demo ? 3000 : 10000;
  carryMs = demo ? 8000 : 25000;
  carryFirstMs = demo ? 35000 : 180000;
  carryEveryMs = demo ? 45000 : 240000;
  MODEL.settleMs = demo ? 5000 : 15000;
  MODEL.horizonMs = demo ? 5000 : 15000;
}
demoBox.addEventListener("change", applyMode);
applyMode();

const detector = new StepDetector();
const liveChart = new LineChart($<HTMLCanvasElement>("liveChart"), 60000, "The chart starts when the beat locks");
const sessionChart = new LineChart($<HTMLCanvasElement>("sessionChart"), null);

// hidden fixed metronome at 100 bpm (press m), no button on screen
const beat = new Beat();
// music on top of the kick during andante (set to false to go back to the plain thump)
const MUSIC_ON = true;
const music = new Music();
async function toggleMetronome() {
  if (andanteOn) return; // andante owns the beat while it's running
  if (beat.playing) return beat.stop();
  await beat.unlock();
  beat.start(100);
}

// carryover: mute the beat for a bit and check whether your pace holds without it
// waits 3 s before muting so you have time to get back into position
let carry: { start: number; until: number; bpm: number; spms: number[]; muted: boolean } | null = null;
let lastCarry: { held: number; at: number } | null = null;
let nextCarryAt: number | null = null;
function startCarry() {
  if (!beat.playing || carry) return;
  const start = performance.now() + 3000;
  carry = { start, until: start + carryMs, bpm: beat.bpm, spms: [], muted: false };
}

// hidden keyboard shortcuts: m = metronome, a = andante, c = carryover
window.addEventListener("keydown", (e) => {
  if (e.key === "m") toggleMetronome();
  if (e.key === "a") andanteBtn.click();
  if (e.key === "c") startCarry();
});

// andante mode: wait for steady steps, then start the beat at your own pace
let andanteOn = false;
const tempo = new TempoController();
const form = new FormTracker();
const recorder = new SessionRecorder();
const model = new PersonModel();
model.load(); // warm start from past sessions

andanteBtn.addEventListener("click", async () => {
  if (andanteOn) {
    andanteOn = false;
    // save the session before resetting everything
    const session = recorder.finish(performance.now(), {
      followPct: model.followReady ? Math.round(model.follow() * 100) : null,
      tempoChanges: model.events,
      riskAtStart: Math.round(model.riskAt(0) * 100),
      riskAtPlus10: Math.round(model.riskAt(0.1) * 100),
    });
    beat.stop();
    beat.mute(false);
    music.stop();
    tempo.reset();
    form.reset();
    model.save(); // remember what it learned for next time
    carry = null;
    nextCarryAt = null;
    andanteBtn.textContent = "START ANDANTE";
    andanteBtn.classList.remove("running");
    if (session) {
      saveSession(session);
      showReport(session);
    }
  } else {
    if (!pose) return setBanner("idle", "Camera isn't on yet", "Click Camera off at the top to try again"); // camera first
    await beat.unlock();
    beat.stop();
    andanteOn = true;
    lastCarry = null;
    andanteBtn.textContent = "END SESSION";
    andanteBtn.classList.add("running");
  }
});

// report screen: fill the numbers, draw the session, then ask the coach
function showReport(s: Session) {
  // show a number, or a grey dash when there's nothing to show
  const put = (id: string, text: string | null) => {
    const el = $(id);
    el.textContent = text ?? "—";
    el.classList.toggle("empty", text === null);
  };
  put("rTempo", `${Math.round(s.startBpm)} → ${Math.round(s.endBpm)}`);
  $("rTempoSub").textContent = `start → end bpm · peak ${Math.round(s.peakBpm)}`;
  put("rOnBeat", s.followPct === null ? null : `${s.followPct}%`);
  put("rCarry", s.carryovers.length ? `${Math.round(Math.max(...s.carryovers) * 100)}%` : null);
  $("rCarrySub").textContent = s.carryovers.length ? "pace held without the beat" : "no check this session";
  put("rLength", String(s.durationS));
  put("rCadence", s.avgSpm === null ? null : String(Math.round(s.avgSpm)));
  put("rForm", s.avgForm === null ? null : String(s.avgForm));

  reportOpen = true;
  route();

  // samples are 1 per second, t in seconds
  sessionChart.clear();
  for (const p of s.samples) sessionChart.push({ t: p.t * 1000, beat: p.bpm, you: p.spm, form: p.form });
  sessionChart.draw();

  askCoach();
}

newSessionBtn.addEventListener("click", () => {
  reportOpen = false;
  route();
});

// after a session: ask the gemini coach and fill the coach card
// runs only after the session ends, never during the live loop
async function askCoach() {
  const summary = $("coachSummary");
  const lists = $("coachLists");
  summary.textContent = "Asking the coach…";
  lists.hidden = true;
  $("coachTrend").textContent = "";
  $("coachLearned").textContent = "–";
  for (const id of ["planStart", "planMax", "planMin", "planFocus"]) $(id).textContent = "–";
  try {
    fillCoach(await getCoachReport(loadSessions()));
  } catch (err) {
    console.error(err);
    summary.textContent = "Coach unavailable: " + (err as Error).message;
  }
}

function fillCoach(r: CoachReport) {
  $("coachSummary").textContent = r.summary;
  const fillList = (id: string, items: string[]) => {
    const ul = $(id);
    ul.replaceChildren(...items.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
  };
  fillList("coachWell", r.wentWell);
  fillList("coachWork", r.toWorkOn);
  $("coachLists").hidden = false;
  $("coachTrend").textContent = r.trend;
  $("coachLearned").textContent = r.learned;
  $("planStart").textContent = `${Math.round(r.nextSession.startBpm)} bpm`;
  $("planMax").textContent = `${Math.round(r.nextSession.maxBpm)} bpm`;
  $("planMin").textContent = `${Math.round(r.nextSession.minutes)} min`;
  $("planFocus").textContent = `Focus: ${r.nextSession.focus}`;
}

// a big number, or a grey dash when there's nothing yet
function setNum(el: HTMLElement, text: string | null) {
  const t = text ?? "—";
  if (el.textContent !== t) el.textContent = t;
  el.classList.toggle("empty", text === null);
}

// status banner: one place that decides what the big coloured box says
type ToneName = "idle" | "green" | "yellow" | "orange" | "red" | "teal" | "purple" | "grey";
function setBanner(tone: ToneName, title: string, sub: string) {
  bannerEl.dataset.tone = tone;
  if (bannerTitle.textContent !== title) bannerTitle.textContent = title;
  if (bannerSub.textContent !== sub) bannerSub.textContent = sub;
}
function updateBanner(now: number) {
  if (!pose) return setBanner("idle", "Starting camera…", "Stand side-on, 2–3 m back");
  if (lastCarry && now - lastCarry.at < 4000) {
    const pct = Math.round(lastCarry.held * 100);
    return setBanner("purple", `Pace held ${pct}%`, pct >= 90 ? "Your rhythm stuck without the beat" : "Your pace drifted without the beat");
  }
  if (carry) {
    if (now < carry.start) return setBanner("purple", `Beat off in ${Math.ceil((carry.start - now) / 1000)}`, "Keep your pace going");
    return setBanner("purple", "Beat off", `Checking if pace holds · ${Math.ceil((carry.until - now) / 1000)} s`);
  }
  if (!andanteOn) {
    if (beat.playing) return setBanner("grey", `Metronome · ${Math.round(beat.bpm)}`, "A plain beat that doesn't listen");
    return setBanner("idle", "Ready", "Press Start Andante, then march side-on");
  }
  if (!beat.playing) return setBanner("teal", "Assessing pace", "The beat starts once your steps are steady");
  if (form.calibrating || tempo.state === "measuring") return setBanner("teal", `Locked at ${Math.round(tempo.base ?? beat.bpm)}`, "Learning your normal form");
  switch (tempo.state) {
    case "speeding up": return setBanner("green", "Speeding up", "Form is good & you're keeping up");
    case "holding (slip predicted)": return setBanner("orange", "Holding · form may slip", "Andante predicted a slip, so it isn't pushing");
    case "easing off": return setBanner("red", "Form slipped · easing off", "Stand tall & lift your knees");
    case "holding (form low)": return setBanner("red", "Form slipped", "Stand tall & lift your knees");
    case "holding (no steps)": return setBanner("grey", "Can't see your steps", "Keep your feet in view");
    case "holding (off beat)": return setBanner("yellow", "Holding · find the beat", "Match your steps to the click");
    case "holding (at max)": return setBanner("green", "Top speed for today", "Hold this pace");
    default: return setBanner("yellow", "Holding · keep it steady", "Settle into this pace");
  }
}

const ctx = overlay.getContext("2d")!;
const draw = new DrawingUtils(ctx);
let pose: PoseLandmarker | null = null;
let lastVideoTime = -1;
let lastChartPush = 0;


// smoothed copy of the landmarks, only for drawing the skeleton
// step counting and form still use the raw points
let drawLm: NormalizedLandmark[] | null = null;
function smoothForDrawing(lm: NormalizedLandmark[]): NormalizedLandmark[] {
  const a = 0.5; // how much of each new frame to take (lower = calmer but laggier)
  drawLm = !drawLm || drawLm.length !== lm.length
    ? lm.map((p) => ({ ...p }))
    : drawLm.map((p, i) => ({
      x: p.x + a * (lm[i].x - p.x),
      y: p.y + a * (lm[i].y - p.y),
      z: p.z + a * (lm[i].z - p.z),
      visibility: lm[i].visibility,
    }));
  return drawLm;
}

// camera starts by itself when the page opens
// if it fails (e.g. permission blocked), click the camera pill to try again
let starting = false;
async function startCamera() {
  if (pose || starting) return;
  starting = true;
  try {
    statusEl.textContent = "Starting…";
    // asks for webcam, starts video, & loads model
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720 },
      audio: false,
    });
    await video.play();

    statusEl.textContent = "Loading…";
    pose = await createPose();

    statusEl.textContent = "Camera on";
    camPill.classList.add("on");
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Camera off";
    setBanner("red", "Camera problem", (err as Error).message);
  } finally {
    starting = false;
  }
}
camPill.addEventListener("click", startCamera);
route();

// phones and tablets (touch only, no mouse): show a "use a laptop" note instead of the app
const touchOnly = matchMedia("(hover: none) and (pointer: coarse)").matches;
if (touchOnly) {
  document.body.classList.add("touch-only");
  $("deviceNote").hidden = false;
} else {
  startCamera();
}

function loop() {
  if (pose && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const now = performance.now();
    // returns 33 body points
    const result = pose.detectForVideo(video, now);

    // match the canvas to the video's real pixel size so points line up
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const lm = result.landmarks[0]; // list of points for one person
    if (lm) {
      const d = smoothForDrawing(lm);
      // neon glow (canvas shadow), then reset so nothing else glows
      ctx.shadowColor = "#29b6c9";
      ctx.shadowBlur = 18;
      draw.drawConnectors(d, PoseLandmarker.POSE_CONNECTIONS, { color: "#7fe9f7", lineWidth: 5 });
      ctx.shadowColor = "#fcd113";
      draw.drawLandmarks(d, { color: "#fcd113", fillColor: "#fcd113", radius: 5 });
      ctx.shadowBlur = 0;
    } else {
      drawLm = null; // start fresh when you come back into view
    }

    // step detection + form
    const { sample, step } = detector.update(lm, now);
    if (sample) graph.push(sample);
    if (step) graph.step(now);
    form.update(lm, video.videoWidth / video.videoHeight, sample ? sample.v : null, now);
    const score = form.score();
    const spm = detector.cadence(now);
    const { steady, spread } = detector.steadiness();

    // only lock onto a real marching pace (stops it locking at 29 while you shuffle at the laptop)
    if (andanteOn && !beat.playing && steady && spm !== null && spm >= 40) {
      beat.start(spm);
      if (MUSIC_ON) music.start();
      tempo.lock(spm, now);
      form.startBaseline(now);
      nextCarryAt = now + carryFirstMs;
      recorder.begin(now, demoBox.checked); // recording starts when beat locks
      model.resetBuffers();
    }

    // automatic carryover: when due, but only while form is good
    if (andanteOn && beat.playing && !carry && nextCarryAt !== null && now >= nextCarryAt && score !== null && score >= TEMPO.formGood) {
      startCarry();
      nextCarryAt = now + carryEveryMs;
    }

    // carryover running: collect your pace, then score it when the mute ends
    if (carry && now >= carry.start) {
      if (!carry.muted) {
        beat.mute(true);
        carry.muted = true;
      }
      // skip the first 2 s so we measure your pace without the beat, not the old one
      if (spm !== null && now - carry.start > 2000) carry.spms.push(spm);
      if (now >= carry.until) {
        beat.mute(false);
        const held = carry.spms.length ? median(carry.spms) / carry.bpm : null;
        if (held !== null) {
          recorder.addCarryover(held);
          lastCarry = { held, at: now };
        }
        carry = null;
      }
    }

    // nudge the tempo while you keep up (paused during carryover)
    if (andanteOn && beat.playing && !carry) {
      // model advice (falls back to the rules until it has enough data)
      tempo.raiseStep = model.raiseStep();
      tempo.slipPredicted = model.slipPredicted();
      const next = tempo.update(now, beat.bpm, spm, score);
      if (next !== null) {
        model.tempoChanged(now, beat.bpm, next);
        beat.setBpm(next, 2);
      }
    }

    // per-person model learns while andante runs (paused during carryover)
    if (andanteOn && beat.playing && !carry && tempo.base !== null) {
      model.update(now, detector.quickCadence(now), beat.bpm, tempo.base, score);
    }

    // music thins out when form slips, goes silent for carryover
    if (music.playing) music.setLevel(carry?.muted ? 0 : levelFor(tempo.state));

    // record one sample per second while andante is running
    if (andanteOn && beat.playing) recorder.record(now, spm, beat.bpm, score, tempo.state);

    // live chart: 4 points a second, beat line breaks while muted
    if (now - lastChartPush > 250) {
      lastChartPush = now;
      liveChart.push({ t: now, beat: beat.playing && !carry?.muted ? beat.bpm : null, you: spm, form: score });
    }

    // screen
    updateBanner(now);
    const muted = !!carry?.muted;
    beatTile.classList.toggle("muted", muted);
    setNum(beatEl, beat.playing ? String(Math.round(beat.bpm)) : null);
    const up = tempo.base ? Math.round((beat.bpm / tempo.base - 1) * 100) : null;
    beatSubEl.textContent = muted ? "silent" : andanteOn && up !== null ? (up > 0 ? `+${up}% from start` : "your starting pace") : beat.playing ? "fixed tempo" : "\u00a0";
    setNum(cadenceEl, spm === null ? null : String(Math.round(spm)));

    const ld = form.leanDelta();
    const lr = form.liftRatio();
    setNum(formEl, form.calibrating ? "…" : score === null ? null : String(score));
    formMarker.hidden = score === null;
    if (score !== null) formMarker.style.left = `${score}%`;
    formDetailEl.textContent = ld === null || lr === null ? (form.calibrating ? "Learning your normal form" : "Measured after the beat locks") : `Lean +${Math.max(0, Math.round(ld))}° · lift ${Math.round(lr * 100)}%`;

    setNum(followEl, model.followReady ? `${Math.round(model.follow() * 100)}%` : null);
    setNum(slipEl, model.slipReady && model.slipRisk !== null && andanteOn ? `${Math.round(model.slipRisk * 100)}%` : null);
    if (!liveView.hidden) liveChart.draw(now);

    // debug page numbers + foot-signal graph
    if (!debugView.hidden) {
      stepsEl.textContent = String(detector.stepCount);
      dCadenceEl.textContent = spm === null ? "–" : String(Math.round(spm));
      steadyEl.textContent = spm === null ? "–" : (steady ? "yes" : "no") + (spread === null ? "" : ` ${Math.round(spread * 100)}%`);
      leanEl.textContent = ld === null ? "–" : `${Math.round(ld)}°`;
      liftEl.textContent = lr === null ? "–" : `${Math.round(lr * 100)}%`;
      tempoStateEl.textContent = tempo.state || "–";
      graph.draw(now);
    }
  }
  requestAnimationFrame(loop);
}
import "./style.css";
import { DrawingUtils, PoseLandmarker } from "@mediapipe/tasks-vision";
import { createPose } from "./pose";
import { StepDetector, median } from "./steps";
import { DebugGraph } from "./graph";
import { Beat } from "./beat";
import { TempoController, TEMPO } from "./tempo";
import { FormTracker, FORM } from "./form";


const video = document.querySelector<HTMLVideoElement>("#video")!;
const overlay = document.querySelector<HTMLCanvasElement>("#overlay")!;
const startBtn = document.querySelector<HTMLButtonElement>("#start")!;
const statusEl = document.querySelector<HTMLSpanElement>("#status")!;

const stepsEl = document.querySelector<HTMLSpanElement>("#steps")!;
const cadenceEl = document.querySelector<HTMLSpanElement>("#cadence")!;
const steadyEl = document.querySelector<HTMLSpanElement>("#steady")!;
const resetBtn = document.querySelector<HTMLButtonElement>("#reset")!;

let carryMs = 8000;
// first carryover runs 35 s after beat locks
let carryFirstMs = 35000;
// after first, carryovers run every 45 s
let carryEveryMs = 45000;

// demo mode squeezes every timer so a full session fits in ~2 min
// real mode uses session-length timers
const demoBox = document.querySelector<HTMLInputElement>("#demo")!;
function applyMode() {
  const demo = demoBox.checked;
  // measuring: 5 s in demo, 60 s in real
  FORM.baselineMs = demo ? 5000 : 60000;
  // speeding up: 6 s in demo, 30 s in real
  TEMPO.stepEveryMs = demo ? 6000 : 30000;
  // easing off: 3s in demo, 10 s in real
  TEMPO.easeEveryMs = demo ? 3000 : 10000;
  // carryover mute: 8 s in demo, 25 s in real
  carryMs = demo ? 8000 : 25000;
  // first automatic carryover after lock: 35 s in demo, 3 min in real
  carryFirstMs = demo ? 35000 : 180000;
  // then repeats: every 45 s in demo, every 4 min in real
  carryEveryMs = demo ? 45000 : 240000;
}
demoBox.addEventListener("change", applyMode);
applyMode();

const detector = new StepDetector();
const graph = new DebugGraph(document.querySelector<HTMLCanvasElement>("#graph")!);
resetBtn.addEventListener("click", () => { detector.reset(); graph.clear(); });

// fixed metronome (demo opener + fallback mode)
// if button click, call beat.start()
const bpmInput = document.querySelector<HTMLInputElement>("#bpm")!;
const metroBtn = document.querySelector<HTMLButtonElement>("#metronome")!;
const beat = new Beat();
metroBtn.addEventListener("click", async () => {
  if (beat.playing) {
    beat.stop();
    metroBtn.textContent = "Start metronome";
  } else {
    await beat.unlock();
    // call if unclocked
    beat.start(Number(bpmInput.value));
    metroBtn.textContent = "Stop metronome";
  }
});
bpmInput.addEventListener("change", () => {
  if (beat.playing) beat.setBpm(Number(bpmInput.value));
});

// carryover: mute the beat for a bit and check whether your pace holds without it
// carry is null when no test is running
// during test, it remembers when tests ends, beat's tempo at start, & steps/min readings
const carryBtn = document.querySelector<HTMLButtonElement>("#carry")!;
const carryEl = document.querySelector<HTMLSpanElement>("#carryResult")!;
let carry: { start: number; until: number; bpm: number; spms: number[]; muted: boolean } | null = null;
// waits 3 s before muting so you have time to get back into position
function startCarry() {
  if (!beat.playing || carry) return;
  const start = performance.now() + 3000;
  carry = { start, until: start + carryMs, bpm: beat.bpm, spms: [], muted: false };
}
carryBtn.addEventListener("click", startCarry);
// when the next automatic carryover is due (null = not scheduled)
let nextCarryAt: number | null = null;

// keyboard shortcuts so you can trigger things from where you're marching
// m = metronome, a = andante, c = carryover
window.addEventListener("keydown", (e) => {
  if (document.activeElement === bpmInput) return;
  if (e.key === "m") metroBtn.click();
  if (e.key === "a") andanteBtn.click();
  if (e.key === "c") startCarry();
});

// andante mode: wait for steady steps, then start the beat at your own pace
const andanteBtn = document.querySelector<HTMLButtonElement>("#andante")!;
const beatEl = document.querySelector<HTMLSpanElement>("#beat")!;
let andanteOn = false;
const tempo = new TempoController();
const form = new FormTracker();
const formEl = document.querySelector<HTMLSpanElement>("#form")!;
const leanEl = document.querySelector<HTMLSpanElement>("#lean")!;
const liftEl = document.querySelector<HTMLSpanElement>("#lift")!;
const coachEl = document.querySelector<HTMLSpanElement>("#coach")!;

andanteBtn.addEventListener("click", async () => {
  if (andanteOn) {
    andanteOn = false;
    beat.stop();
    tempo.reset();
    form.reset();
    beat.mute(false);
    carry = null;
    nextCarryAt = null;
    andanteBtn.textContent = "Start Andante";
  } else {
    await beat.unlock();
    beat.stop();
    metroBtn.textContent = "Start metronome";
    andanteOn = true;
    andanteBtn.textContent = "Stop Andante";
  }
});

const ctx = overlay.getContext("2d")!;
const draw = new DrawingUtils(ctx);
let pose: PoseLandmarker | null = null;
let lastVideoTime = -1;

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  try {
    statusEl.textContent = "Starting camera…";
    // on click: asks for webcam, starts video, & loads model
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720 },
      audio: false,
    });
    await video.play();

    statusEl.textContent = "Loading pose model…";
    pose = await createPose();

    statusEl.textContent = "Running";
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Error: " + (err as Error).message;
    startBtn.disabled = false;
  }
});

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
      // draws bones
      draw.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, { color: "#ea44a5", lineWidth: 3 });
      // draws joints
      draw.drawLandmarks(lm, { color: "#f19f12", radius: 3 });
    }

    // step detection + readout
    const { sample, step } = detector.update(lm, now);
    if (sample) graph.push(sample);
    if (step) graph.step(now);
    // form: lean + lift vs your baseline
    form.update(lm, video.videoWidth / video.videoHeight, sample ? sample.v : null, now);
    const score = form.score();
    const ld = form.leanDelta();
    const lr = form.liftRatio();
    formEl.textContent = form.calibrating ? "measuring" : score === null ? "–" : String(score);
    leanEl.textContent = ld === null ? "–" : `+${Math.max(0, Math.round(ld))}°`;
    liftEl.textContent = lr === null ? "–" : `${Math.round(lr * 100)}%`;
    graph.draw(now);
    const spm = detector.cadence(now);
    const { steady, spread } = detector.steadiness();
    stepsEl.textContent = String(detector.stepCount);
    cadenceEl.textContent = spm === null ? "–" : String(Math.round(spm));
    steadyEl.textContent = spm === null ? "–" : (steady ? "Yes" : "No") + (spread === null ? "" : ` ${Math.round(spread * 100)}%`);

    // lock on: first time steps are steady, start the beat at that cadence
    if (andanteOn && !beat.playing && steady && spm !== null) {
      beat.start(spm);
      tempo.lock(spm, now);
      form.startBaseline(now);
      nextCarryAt = now + carryFirstMs;
    }

    // automatic carryover: when due, but only while form is good
    // slouch doesn't spoil measurement
    if (andanteOn && beat.playing && !carry && nextCarryAt !== null && now >= nextCarryAt && score !== null && score >= TEMPO.formGood) {
      startCarry();
      nextCarryAt = now + carryEveryMs;
    }

    // carryover running: collect your pace, then score it when the mute ends
    if (carry && now < carry.start) {
      // countdown before the mute
      carryEl.textContent = `mute in ${Math.ceil((carry.start - now) / 1000)}s`;
    } else if (carry) {
      if (!carry.muted) {
        beat.mute(true);
        carry.muted = true;
      }
      // skip the first 2 s so we measure your pace without the beat, not the old one
      if (spm !== null && now - carry.start > 2000) carry.spms.push(spm);
      const left = Math.ceil((carry.until - now) / 1000);
      carryEl.textContent = `muted ${left}s`;
      if (now >= carry.until) {
        beat.mute(false);
        const held = carry.spms.length ? median(carry.spms) / carry.bpm : null;
        carryEl.textContent = held === null ? "no steps" : `${Math.round(held * 100)}% held`;
        carry = null;
      }
    }

    // nudge the tempo up while you keep up with it
    // paused during carryover so the tempo doesn't change while muted
    if (andanteOn && beat.playing && !carry) {
      const next = tempo.update(now, beat.bpm, spm, score);
      if (next !== null) beat.setBpm(next, 2);
    }
    coachEl.textContent = beat.playing && andanteOn ? tempo.state || "–" : "–";
    beatEl.textContent = beat.playing ? String(Math.round(beat.bpm)) : andanteOn ? "listening" : "–";
    // keep the bpm box showing the live tempo
    if (beat.playing && document.activeElement !== bpmInput) bpmInput.value = String(Math.round(beat.bpm));
  }
  requestAnimationFrame(loop); // runs about 60 times a second
}
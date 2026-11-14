import "./style.css";
import { DrawingUtils, PoseLandmarker } from "@mediapipe/tasks-vision";
import { createPose } from "./pose";
import { StepDetector } from "./steps";
import { DebugGraph } from "./graph";
import { Beat } from "./beat";
import { TempoController } from "./tempo";
import { FormTracker } from "./form";


const video = document.querySelector<HTMLVideoElement>("#video")!;
const overlay = document.querySelector<HTMLCanvasElement>("#overlay")!;
const startBtn = document.querySelector<HTMLButtonElement>("#start")!;
const statusEl = document.querySelector<HTMLSpanElement>("#status")!;

const stepsEl = document.querySelector<HTMLSpanElement>("#steps")!;
const cadenceEl = document.querySelector<HTMLSpanElement>("#cadence")!;
const steadyEl = document.querySelector<HTMLSpanElement>("#steady")!;
const resetBtn = document.querySelector<HTMLButtonElement>("#reset")!;

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

// andante mode: wait for steady steps, then start the beat at your own pace
const andanteBtn = document.querySelector<HTMLButtonElement>("#andante")!;
const beatEl = document.querySelector<HTMLSpanElement>("#beat")!;
let andanteOn = false;
const tempo = new TempoController();
const form = new FormTracker();
const formEl = document.querySelector<HTMLSpanElement>("#form")!;
const leanEl = document.querySelector<HTMLSpanElement>("#lean")!;
const liftEl = document.querySelector<HTMLSpanElement>("#lift")!;

andanteBtn.addEventListener("click", async () => {
  if (andanteOn) {
    andanteOn = false;
    beat.stop();
    tempo.reset();
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
    form.update(lm, video.videoWidth / video.videoHeight, sample ? sample.v : null, step, now);
    const score = form.score();
    const ld = form.leanDelta();
    const lr = form.liftRatio();
    formEl.textContent = form.calibrating ? "measuring" : score === null ? "–" : String(score);
    leanEl.textContent = ld === null ? "–" : `${ld >= 0 ? "+" : ""}${Math.round(ld)}°`;
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
    }

    // nudge the tempo up while you keep up with it
    if (andanteOn && beat.playing) {
      const next = tempo.update(now, beat.bpm, spm);
      if (next !== null) beat.setBpm(next, 2);
    }
    beatEl.textContent = beat.playing ? String(Math.round(beat.bpm)) : andanteOn ? "listening" : "–";
    // keep the bpm box showing the live tempo
    if (beat.playing && document.activeElement !== bpmInput) bpmInput.value = String(Math.round(beat.bpm));
  }
  requestAnimationFrame(loop); // runs about 60 times a second
}
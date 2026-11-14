import "./style.css";
import { DrawingUtils, PoseLandmarker } from "@mediapipe/tasks-vision";
import { createPose } from "./pose";
import { StepDetector } from "./steps";
import { DebugGraph } from "./graph";


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
    graph.draw(now);
    const spm = detector.cadence(now);
    const { steady } = detector.steadiness();
    stepsEl.textContent = String(detector.stepCount);
    cadenceEl.textContent = spm === null ? "–" : String(Math.round(spm));
    steadyEl.textContent = spm === null ? "–" : steady ? "Yes" : "No";
  }
  requestAnimationFrame(loop); // runs about 60 times a second
}
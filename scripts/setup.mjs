// copy mediapipe's runtime files into public/ and downloads the pose model
// works without internet
import { cp, mkdir, writeFile, access } from "node:fs/promises";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task";
const MODEL_PATH = "public/models/pose_landmarker_heavy.task";

// copy the runtime files (.wasm) out of node_modules into public/wasm
await cp("node_modules/@mediapipe/tasks-vision/wasm", "public/wasm", { recursive: true });
console.log("wasm -> public/wasm");

// download the heavy pose model once
await mkdir("public/models", { recursive: true });
try {
  await access(MODEL_PATH);
  console.log("model already present");
} catch {
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`model download failed: ${res.status}`);
  await writeFile(MODEL_PATH, Buffer.from(await res.arrayBuffer()));
  console.log("model -> " + MODEL_PATH);
}
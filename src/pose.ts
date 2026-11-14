// loads mediapie pose landmarker from the local files in public/
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

export async function createPose(): Promise<PoseLandmarker> {
  const vision = await FilesetResolver.forVisionTasks("/wasm");
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "/models/pose_landmarker_heavy.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.3,
    minPosePresenceConfidence: 0.3,
    minTrackingConfidence: 0.3,
  });
}
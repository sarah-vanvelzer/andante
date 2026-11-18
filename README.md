# Andante
 
**Adaptive rhythm for walking rehab, from a laptop webcam.**

https://github.com/user-attachments/assets/d95b847a-21de-4949-98d1-be497d8a620e
 
Andante watches you march side-on through your webcam, plays a beat at your own pace, nudges the tempo up while your form holds, and eases off when it slips. A small on-device model learns how you respond, and after each session a Gemini coach writes a short report and plans your next one.
 
Built solo at HackPrinceton Fall 2026 (Healthcare track).
 
- **Live demo:** https://andante-rehab.vercel.app (laptop or desktop with a webcam; phones are blocked)
- **Video:** https://youtu.be/_2lE4HKmOzI
- **Devpost:** https://devpost.com/software/andante
> Andante is a hackathon prototype, not a medical device. It has not been clinically validated and is not a treatment for any condition. It is designed for indoor use.
 
## How it works
 
```
webcam → MediaPipe pose (in browser) → steps + cadence → form score (lean + knee lift)
                                                 ↓
           rules + on-device model → tempo nudges → Tone.js beat + music
                                                 ↓
                          session ends → numbers only → Gemini coach report
```
 
1. **Lock.** When your steps are steady, the beat starts at your own cadence.
2. **Measure form.** Andante records your normal trunk lean and knee lift for a few seconds after the beat locks.
3. **Adapt.** While your form is good and you're on the beat, the tempo rises a few percent at a time, up to +15%. If your form slips, it eases back down, but never below your starting pace.
4. **Carryover checks.** Every so often the beat goes silent to check whether your pace holds without it.
5. **Learn.** A small model learns how much of each speed-up you follow and predicts form slips a few seconds ahead, so Andante can hold instead of pushing.
6. **Coach.** After the session, a Gemini coach turns the numbers into a report and a next-session plan.
## Tech
 
| Part | What it uses |
|---|---|
| Pose tracking | MediaPipe Pose Landmarker (heavy), GPU, runs in the browser |
| Step detection | Foot-gap signal with adaptive thresholds; cadence = median of recent strides |
| Form | Trunk lean vs. your baseline + knee lift vs. your own recent range |
| Beat + music | Tone.js. The beat runs on its own clock; cadence only nudges the tempo |
| Tempo control | Rule-based controller (floor, ceiling, ease-off, hold when off beat) |
| Per-person model | Weighted follow-rate estimate + 4-feature logistic regression (online SGD), warm-started from past sessions in localStorage |
| Coach | Gemini API with structured JSON output, called from a Vercel serverless function after the session only |
| App | Vite + TypeScript, Canvas charts, hosted on Vercel |
 
**Privacy:** video never leaves the browser. Only session numbers (cadence, tempo, form scores, carryover results, model summary) are sent to Gemini, and only after a session ends. AI is never in the real-time loop.
 
## Run it locally
 
You need Node 20+ and a webcam.
 
```bash
npm install
npm run setup     # copies the MediaPipe wasm files and downloads the pose model into public/
```
 
For the Gemini coach, create `.env.local` in the project root:
 
```
GEMINI_API_KEY=your-key-here
```
 
Then:
 
```bash
npm run dev
```
 
Open http://localhost:5173, allow the camera, and stand side-on 2–3 m back with your whole body in frame. Turn on **Demo mode** (top bar) for short timers that fit a full session into about 2 minutes.
 
**Fonts:** the design uses Lenia Sans. If it doesn't load, the app falls back to Figtree from Google Fonts automatically, and everything works the same.
 
## Project layout
 
```
api/coach.ts        Vercel function: builds the prompt and calls Gemini with a JSON schema
src/main.ts         wires everything together: camera loop, screens, carryover, report
src/pose.ts         loads MediaPipe Pose Landmarker
src/steps.ts        step detection, cadence, steadiness
src/form.ts         lean + lift form score
src/tempo.ts        rule-based tempo controller
src/model.ts        per-person model (follow rate + slip predictor)
src/beat.ts         Tone.js kick on the transport clock
src/music.ts        music layers that build and thin with your form
src/session.ts      session recording + local history
src/coach.ts        sends the session to /api/coach
src/chart.ts        live and session charts
scripts/setup.mjs   fetches MediaPipe assets
```
 
## Shortcuts
 
- `a`: start or end a session
- `c`: run a carryover check now
- `m`: plain metronome at 100 bpm (for comparison)
- **Debug** button: raw step signal, cadence, steadiness, lean and lift
## Results so far (my own testing)
 
- 40/40 steps counted at 80 bpm vs. a hand count
- Pace held 91–103% during carryover checks
- Follow rate 57–81% across sessions
- Tried by Amazon recruiters and 3 judges at HackPrinceton
## What I learned
 
- My first two step detectors (ankle separation, knee height) failed. Knee height caught only about 66% of steps at 100 bpm, because MediaPipe swaps the left and right legs from the side. A label-free foot-gap signal fixed it.
- Measuring stride time instead of step time let slow and uneven gaits lock onto the beat.
- Keeping AI out of the real-time loop made the system simpler and safer. The beat stays steady, and the smarter parts advise rather than control.
## Prior art
 
Adaptive rhythmic cueing for gait already exists, for example MedRhythms InTandem, which uses dedicated shoe sensors. Andante explores doing it with just a webcam and a browser.
 

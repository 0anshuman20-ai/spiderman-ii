# COSMIC WEAVER // VEYL STUDIO — PRD

> Architecture of record: **`memory/TERMINAL_PLAN.md`** — the five inversions (Performance File,
> neural person layer, character factory, Dream Forge, and the **Omega Layer**) and Phases 0–5 + Ω.
> This PRD tracks what is *shipped*; the terminal plan tracks where it is *going*.

## Original Problem Statement
Build the definitive $0 in-browser recording studio for the COSMIC WEAVER YouTube Shorts channel: a 3D masked character (VEYL — black/crimson suit, glowing web-circuit lines, reflective lenses) replaces the creator on screen, driven live by their webcam. The user explicitly demanded the known gaps be filled: not just face tracking but **body + hand tracking**, all free, "no weakness", definitive. Recording must be one-click, upload-ready vertical video. Raw webcam is never recorded (local PIP preview only). Voice is transformed live into a deep-space transmission voice.

## User Choices (June 2026)
- Tracking: Face + upper body + hands (MediaPipe Face/Pose/Hand landmarkers)
- Output: WebM 1080×1920 60fps, one-click download
- Full content system: 30 scripts, hook bank, 5 worlds, expression hotkeys
- Voice: processed transmission voice recorded (never raw)

## Architecture
- **Frontend (React + three.js, no build-time 3D assets):**
  - `src/studio/avatar.js` — fully procedural VEYL: rigged head (lenses, brows, jaw voice-bar), torso, articulated arms with fingered hands, shoulder particle glow, emissive web-circuit canvas texture, 5 expressions, glitch bursts, idle zero-g animation.
  - `src/studio/tracking.js` — MediaPipe tasks-vision (models + wasm self-hosted in `public/models` & `public/wasm`): FaceLandmarker (blendshapes + head matrix), PoseLandmarker (arm/torso world landmarks → bone quaternions, mirrored), HandLandmarker (finger curl, half-rate). Exponential smoothing. **SIM mode** drives the whole rig procedurally when no camera.
  - `src/studio/voice.js` + `public/worklets/*` — AudioWorklet DSP: noise gate, granular pitch shifter (core + sub-octave layers), presence EQ, comms band, bitcrush/drive/pink-noise/crackle, procedural convolver reverb, compressor+limiter. 5 presets. Glitch bursts. Graceful degrade when mic denied.
  - `src/studio/stage.js` — 1080×1920 renderer, 5 procedural worlds (`worlds.js`), bloom + custom CRT/scanline/chromatic-aberration shader (burned into recording), camera drift + punch-ins, HUD title burned in.
  - `src/studio/recorder.js` — canvas.captureStream(60) + processed voice → MediaRecorder VP9/Opus WebM, auto-download.
  - `src/studio/scripts.js` — 30 transmissions (5 pillars), beats with emote/fx/director notes; teleprompter auto-advances and auto-performs expressions/fx during recording.
  - UI: dark broadcast terminal (JetBrains Mono/Chivo), hotkeys (1-5 worlds, Q-T expressions, G glitch, Space REC).
- **Backend (FastAPI + Mongo):** `/api/takes` CRUD (metadata), `/api/progress/{n}` recorded-script tracker, `/api/stats`.

## Implemented (2026-06)
- Full studio MVP end-to-end, tested by testing agent: 100% backend (6/6), 100% frontend flows including real recording (WebM produced, beats auto-advanced, progress persisted). Zero console errors.
- **Full-mirror upgrade**: articulated legs (thigh/shin/foot from pose landmarks), root motion (avatar follows your left/right position, distance via shoulder-width, crouch via hip height — AR-filter behavior), teardrop spider lenses with rims + studio environment reflections (PMREM RoomEnvironment), heroic V-torso proportions, realism pass on emissives/bloom. Live-tracking sign corrections (head pitch, torso lean). Recording regression re-verified (17s VP9/Opus take persisted).

## Backlog (prioritized)
- P1: Leg/hip tracking option; per-finger articulation from full hand landmarks; recording countdown (3-2-1); take preview player in-panel.
- P1: Honest MP4 export (transcode via ffmpeg.wasm) for platforms that reject WebM.
- P2: Custom world editor; background music bed mixer; caption burn-in from script beats; OBS virtual-camera guidance page.
- P2: Persist takes as files (object storage) instead of metadata-only.

## Known Constraints (documented honestly)
- Single 2D webcam: face is high fidelity, body is upper-body estimation (visibility-gated, eases to idle when limbs leave frame). Not mocap-grade — smoothing trades ~80ms responsiveness for stability.
- Expression ceiling is the procedural rig's 5 expressions (extendable in avatar.js EXPR table).
- WebM output (YouTube accepts directly); MP4 not generated in-browser.

# RETENTION FIX PLAN — Live Take Pipeline Overhaul

## Why this plan exists

Analytics: ~90% swipe-away, <50% watch retention on live freestyle takes.
Forensic analysis of a real published take (`spacespidey-freestyle-take-132258.webm`, 19.2s) measured:

| Metric | Actual take | Required |
|---|---|---|
| Resolution / codec | 720x1280 VP8 (WebM) | 1080x1920 H.264 |
| Effective unique framerate | ~8.8 fps (168 unique frames) | 30+ fps |
| Video bitstream | ~72 KiB total (near-static picture) | — |
| Integrated loudness | -5.7 LUFS | -14 LUFS (YouTube) |
| True peak | +2.9 dBTP (clipping) | <= -1.0 dBTP |
| Loudness range (LRA) | 3.6 LU (crushed) | ~6+ LU |
| Framing | Face fills frame edge-to-edge, mask top cropped, jaw at bottom edge, worlds invisible | Chest-up medium shot, world visible |
| Hook | None — frame 1 is a static stare; frames 1-19 visually near-identical | Visual change every 2-3s, hook in first 1.5s |

Root-cause conclusion: this is not a bad take. It is the **only possible output** of the
current pipeline on a live recording. Four structural defects interact:

1. **Tier death spiral** — live mic + low measured fps forces the lowest encode tier, always.
2. **Main-thread ML stall** — 4 MediaPipe models run synchronously per frame → ~9 fps stage.
3. **720p person-layer cap + 32% sensor crop** — extreme close-up framing is unavoidable.
4. **~+23-27 dB static gain stack into a non-brickwall compressor** — guaranteed clipping.

---

## PHASE 1 — Tracking performance (root cause of the fps collapse)

**File: `frontend/src/studio/tracking.js`**

Problem: `tick()` runs FaceLandmarker + PoseLandmarker + HandLandmarker + ImageSegmenter
back-to-back, synchronously, on the main thread, every frame — while live speech
recognition, the WebGL render loop, and the encoder compete for the same thread.
Measured result: ~8.8 unique fps. The recorder's watchdog duplicates frames to keep the
encoder fed, masking the stall but shipping a slideshow.

Changes:
1. **Stagger model cadence** (frame-counter based):
   - FaceLandmarker: every frame (drives mouth/jaw + expressions — most visible).
   - PoseLandmarker: every 2nd frame, results interpolated/smoothed between runs.
   - HandLandmarker: every 3rd frame, interpolated.
   - ImageSegmenter: every 2nd frame; reuse previous mask between runs (already smoothed).
2. **Frame budget guard**: measure per-tick ML time; if a rolling average exceeds ~14ms,
   automatically widen stagger intervals (pose→3, hands→4, seg→3). If it recovers, tighten.
3. **Raise segmentation working resolution** from 288x512 to 432x768 *only when* the frame
   budget shows headroom (this trades some of the reclaimed time back for better matte edges).
4. **Never let tracking block the render**: if a model run would exceed the remaining frame
   budget, skip it this frame and reuse the last result rather than stalling the composite.

Acceptance: stage fps >= 28 sustained on the same hardware while live mic + full body
tracking are active (verify via the recorder's own fps probe logs).

---

## PHASE 2 — Recorder tier logic (unlock 1080p for live takes)

**File: `frontend/src/studio/recorder.js`**

Problems in `pickTier()`:
- Measured stage fps < 28 → forces `low` tier (720p, WEBM_FIRST ladder, 3.5 Mbps VP8).
- `micLive === true` → unconditional extra step-down, punishing every live take by design.
- Net effect: the premium WebCodecs H.264 1080p path can never fire for the app's primary
  content format (live freestyle).

Changes:
1. **Remove the blanket `micLive` step-down.** Live mic cost is already reflected in the
   measured stage fps; double-penalizing it is what guarantees the floor tier.
2. **Re-probe fps after Phase 1 lands** — with tracking staggered, the fps gate should pass
   naturally. Keep the fps gate itself (it is correct), but re-measure over a longer window
   (2-3s) so a transient dip does not lock in `low` for the whole take.
3. **Mid-take tier is fixed (correct), but add a pre-roll gate**: if the 2-3s probe still
   resolves below `medium`, surface a blocking warning in the UI ("Performance too low for
   quality recording — close other tabs / plug in power") instead of silently recording a
   9 fps 720p take. Recording may proceed only on explicit override.
4. **Prefer the H.264 (WebCodecs / MP4) ladder for `medium` and above**; keep WEBM_FIRST
   only as the true floor fallback.
5. **Watchdog telemetry**: count duplicated frames; if duplicates exceed ~20% of frames,
   flag the take in the UI after stop ("This take dropped frames — review before publishing").

Acceptance: a live take on healthy hardware records 1080x1920 H.264 at >= 28 effective fps;
a degraded machine gets a pre-roll warning instead of a silent floor-tier take.

---

## PHASE 3 — Person layer resolution + framing (kill the forced close-up)

**Files: `frontend/src/studio/tracking.js`, `frontend/src/studio/motion.js`**

Problems:
- `CROP_W = 720, CROP_H = 1280` hard-caps the person layer at 720p regardless of tier.
- A landscape 1080p webcam cover-cropped to 9:16 keeps only a 607x1080 sliver — 32% of
  sensor width. At normal sitting distance the head *must* fill the frame.
- Root-motion distance scaling in motion.js can park the avatar nose-to-lens, cropping the
  mask top and pushing the jaw (the only "alive" element) off the bottom edge.
- Segmentation matte at 288x512 upscaled → soft haloed edges ("cheap filter" look).

Changes:
1. **Raise crop constants to 1080x1920** when the camera delivers >= 1080p; keep 720x1280
   as the fallback for weaker cameras. Person-layer resolution follows the encode tier.
2. **Request portrait-friendly constraints** from getUserMedia (ideal 1080p, and where
   supported, portrait aspect) to reduce the cover-crop loss.
3. **Default framing = chest-up medium shot**: recalibrate the root-motion distance mapping
   so the resting pose shows head + shoulders + upper chest with the mask fully in frame.
4. **Framing clamp**: face height may never exceed ~55-60% of frame height. Clamp the
   root-motion Z/scale output; punch-ins are allowed only as deliberate, time-limited
   camera moves (Phase 5), never as a resting state.
5. **Headroom rule**: keep ~8-10% margin above the mask top at rest.
6. Segmentation resolution bump is covered in Phase 1 (budget-gated).

Acceptance: on a fresh live take, mask fully visible with headroom, shoulders in frame,
world layer clearly visible behind the character; matte edges materially cleaner at 1080p.

---

## PHASE 4 — Audio gain-staging rebuild (kill the clipping)

**File: `frontend/src/studio/spideyVoice.js`**

Problem: the live-mic chain stacks ~+23-27 dB of static gain:
boost x2.0 (+6 dB) → AGC leveler (up to +9 dB) → EQ boosts (+3, +5, +2.5 dB) →
trim x1.9 (+5.6 dB) → main-chain EQ (+2, +3.5, +1.5 dB) → mic-mode makeup x2.0 (+6 dB) →
DynamicsCompressor at 20:1. A WebAudio DynamicsCompressor is NOT a brickwall limiter — with
this much overshoot it leaks several dB, and Opus encoding adds intersample overs.
Measured output: -5.7 LUFS, +2.9 dBTP, LRA 3.6. YouTube normalizes it down ~8 dB, so the
published short keeps the distortion and loses the loudness.

Changes:
1. **Set a single loudness target: -14 LUFS integrated, -1.5 dBTP ceiling.**
2. **Collapse static gains**: remove the x2.0 boost and x2.0 mic-mode makeup; reduce trim
   to unity; keep ONE calibrated makeup stage sized so typical speech lands near -18 to
   -16 LUFS *before* the leveler.
3. **Keep the AGC leveler** but cap its max boost at +6 dB and target -16 LUFS short-term.
4. **Tame the EQ**: cut boosts to <= +3 dB each; prefer subtractive EQ (cut mud around
   250-400 Hz) over stacked presence boosts.
5. **Real limiting**: final DynamicsCompressor configured as a safety stage
   (threshold ~-6 dB, ratio 12:1, knee 0, attack ~0.002, release ~0.15), followed by a
   hard-ceiling WaveShaper/gain clamp at -1.5 dBFS to guarantee true-peak headroom into
   Opus. The limiter should be *barely* working in normal speech (< 3 dB GR), not pinned.
6. **Verification hook**: after each take, compute integrated LUFS + peak from the recorded
   buffer (offline AnalyserNode pass or lightweight LUFS estimator) and log it; surface a
   post-take warning if outside -16..-12 LUFS or above -1.0 dBTP.

Acceptance: a normal-voiced live take measures -16 to -13 LUFS integrated, true peak
<= -1.0 dBTP, LRA >= 5, with no audible distortion on phone speakers.

---

## PHASE 5 — Hook + visual change engine (the retention layer)

**Files: `frontend/src/studio/motion.js`, director/FX modules, caption renderer**

Problem: frame 1 is a static stare; no burned-in hook on freestyle takes; no expression,
glitch, punch-in, or world event fires; captions render low and get clipped by the torso.
19 seconds with zero visual change = swipe.

Changes:
1. **Cold-open hook (first 1.5s)**: on record start, fire an automatic entrance beat —
   expression pop + quick camera punch-out from medium-close to the resting medium shot +
   world energy pulse. Freestyle takes get the same burned-in hook-text treatment scripted
   takes get (auto-text from the first recognized phrase if no hook is set).
2. **Visual-change scheduler**: a director tick guarantees at least one visible change every
   2.5-3s, drawing from: camera punch-in/out (respecting the Phase 3 framing clamp),
   expression cycle, glitch burst, world event (meteor/energy pulse), light shift. Changes
   are speech-aware where possible (trigger on detected emphasis/pauses).
3. **Speech-reactive intensity**: map live mic RMS/energy to subtle idle-motion amplitude so
   the character visibly "performs" louder lines.
4. **Caption placement fix**: move captions to the upper-middle safe zone (clear of the
   torso and of platform UI), word-level highlight timing, max 2 lines.
5. **Silence guard**: if no visual change AND no speech for > 4s during recording, fire a
   subtle idle event automatically.

Acceptance: rendered take shows an entrance beat in the first 1.5s and no 3s window without
a visible change; captions fully legible and unclipped for the whole take.

---

## PHASE 6 — Pre-flight + post-take quality gates (never publish a broken take again)

**Files: `frontend/src/studio/recorder.js`, studio UI**

1. **Pre-roll check (before countdown)**: probe stage fps (2-3s), mic level (speak test:
   reject if peaks < -30 dBFS or constant > -3 dBFS), camera resolution, and framing clamp
   status. Show a single go/no-go panel with specific fixes.
2. **Post-take report card**: effective fps, duplicated-frame %, resolution/codec/tier,
   LUFS/true peak, hook-present flag, visual-change count. One-glance pass/fail per row.
3. **Publish guard**: soft-block publishing any take that failed a critical row (fps < 24
   effective, loudness outside range, floor tier) — overridable but never silent.

Acceptance: the pipeline cannot silently emit another 9 fps / 720p / clipped take.

---

## Execution order & dependencies

1. **Phase 1 (tracking stagger)** — root cause of fps collapse; unlocks Phase 2.
2. **Phase 4 (audio rebuild)** — independent; fixes the harshest per-viewer defect.
3. **Phase 2 (tier logic)** — depends on Phase 1 fps recovery.
4. **Phase 3 (resolution + framing)** — depends on Phase 1 headroom for the bigger crop/seg.
5. **Phase 5 (hook + change engine)** — depends on Phase 3 framing clamp for punch-ins.
6. **Phase 6 (quality gates)** — last; verifies everything above and locks it in.

## Verification (end-to-end, after all phases)

Record a real live take on the same hardware class and confirm via ffprobe/ffmpeg analysis:
- 1080x1920, H.264 preferred, >= 28 effective unique fps, duplicated frames < 10%
- -16..-13 LUFS integrated, true peak <= -1.0 dBTP, LRA >= 5, no audible clipping
- Mask fully in frame with headroom; shoulders visible; world layer visible
- Entrance beat within 1.5s; no 3s static window; captions unclipped

---

## Progress log

- [x] **Phase 1 — tracking stagger**: staggered face/hands/seg cadence in `studio/tracking.js`.
- [x] **Phase 2 — tier logic**: countdown fps probe (`probeFps`) feeds `pickTier` fpsOverride in
      `studio/recorder.js`; H.264/MP4-first for high/medium tiers.
- [x] **Phase 3 — resolution + framing**: headroom rule + framing clamp (`stage.framing`,
      55–60% face-height ceiling) in `studio/suit.js` / stage.
- [x] **Phase 4 — audio rebuild**: loudness chain + `lastTakeAudioReport` verification in
      `studio/spideyVoice.js`; fallback-mode silent-take bug fixed (voice+score into one stream).
- [x] **Phase 5 — hook + change engine**: `studio/director.js` — cold-open beat at 0.25s,
      2.5–3s visual-change scheduler (doubles as the silence guard), speech-reactive
      emphasis, freestyle hook-text burn. Armed after roll, `noteChange()` from scripted beats,
      stopped on every stop/unmount path.
- [x] **Phase 6 — quality gates**:
      - Pre-roll gate: countdown probe blocks the roll below 28fps behind the go/no-go
        panel (`preflight-panel` in `Studio.jsx`) showing fps / camera res / framing status,
        with CANCEL (releases capture) and RECORD ANYWAY (explicit override).
      - Post-take report card: `studio/reportCard.js` (`buildTakeReport`) folded into each
        take entry; PASS/FLAGGED chip + one-glance rows rendered in `TakesPanel.jsx`.
      - Publish guard: a flagged take skips auto-download; ▼ SAVE is the explicit override.
- Build verified (`yarn build` clean). Mic-level speak test in the pre-roll was intentionally
  scoped down to fps as the sole blocker: a silent performer during the countdown would
  false-fail a speak test; loudness is verified post-take by the report card instead.

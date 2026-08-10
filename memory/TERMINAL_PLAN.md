# COSMIC WEAVER // VEYL STUDIO — THE TERMINAL PLAN (v2, Ω)

$0 forever. Fully in-browser. Offline-capable PWA. Every technology named is verified real,
free, and running in browsers today. Failure of any gated component degrades to today's
behavior — never below it.

This document is the canonical architecture. `memory/PRD.md` records what is actually shipped.

---

## THE SPINE — FIVE INVERSIONS

Four inversions carried the plan. Each alone would be a flagship. But all four still assumed
one thing: **that a shot is something a camera saw a person do.** Inversion 5 removes that
assumption. That is the Omega Layer.

**Inversion 1 — The take is a PERFORMANCE, not pixels.**
Recording captures a `.veyl` Performance File: raw webcam encoded live via WebCodecs into OPFS,
the full-rate rig timeline (landmarks, hand poses, blendshapes, voice envelope, ~200KB/min
binary), and the direction timeline (world, camera, FX, beats, music). The live view is a
preview only; the real render happens offline with unbounded time — a laptop that previews at
720p exports 4K60. Performance and rendering decoupled → virtual multicam from one take,
rig-interpolated speed ramps, and the Ghost Double. The take is immortal.

**Inversion 2 — The person is FOOTAGE, not a filter.**
RVM (Robust Video Matting) replaces single-frame segmentation: recurrent temporal state, true
alpha with hair strands, no flicker by architecture. Plus monocular depth, screen-space
normals, world-coupled relighting, and a true 3D face piece anchored to the 468-point mesh.
Offline export runs a forward+backward two-pass matte — the matte sees the future.

**Inversion 3 — The app is a CHARACTER FACTORY, not a camera.**
Local WebLLM writes in VEYL's voice; the Canon Engine gives the series persistent memory;
local neural TTS gives the Scene Partner its own voice. The studio runs a show with you.

**Inversion 4 — The studio MANUFACTURES reality, it doesn't just composite it.**
SD-Turbo on WebGPU is the Dream Forge: type a world, get a world — projected onto the
environment dome, palette-extracted to drive relighting and music, saved as a preset. Plus
true path-traced hero frames, because offline time is free.

**Inversion 5 — THE OMEGA LAYER: the shot ESCAPES LIVE-ACTION.**
Everything above still needs you in the chair, in frame, doing the thing. Omega severs that
last cord. Because the performance is *data* and the world is *3D*, VEYL can appear in shots
that were never acted, framed by cameras no webcam could hold, moving through motion no body
in a bedroom could produce — and the studio stops delivering takes and starts delivering
**episodes**. Live-action becomes one source among several, not the medium.

---

## PHASES 0–5 (unchanged spine, abbreviated)

- **PHASE 0 — SUBSTRATE.** CRA→Vite. `engine.js` frame graph with a live/offline dual clock.
  All ML in a worker. Three-tier inference cascade (WebNN → WebGPU → WASM-SIMD). Performance
  Governor. WebGPU-first three.js renderer. The Vault (OPFS). `.veyl` v1 container. PWA.
- **PHASE 1 — THE PERSON LAYER.** RVM matte (+offline 2-pass), Depth Anything V2, WebGPU
  optical flow, One-Euro filtering, true 3D mask, world-coupled relighting, gesture FSM,
  30s calibration profile.
- **PHASE 2 — WORLDS & THE DIRECTOR.** Gaussian-splat photoreal worlds, the Dream Forge,
  Director AI, the Reshoot Room (multicam re-render, rig speed ramps, Ghost Double),
  audio-reactive worlds, depth parallax, per-world cinematic finishing, World Editor.
- **PHASE 3 — THE SHOW ENGINE.** WebLLM writer's room, Canon Engine, neural-TTS Scene
  Partner, Whisper captions, WebCodecs export v2, local analytics, perceptual QA gate, batch.
- **PHASE 4 — THE VOICE.** Formant-preserving phase vocoder, RNNoise, broadcast chain to
  −14 LUFS, procedural per-world music, adaptive sound design, one nervous system.
- **PHASE 5 — LIVE & TOGETHER.** Virtual camera out, P2P duet, golden-performance regression
  in CI, device matrix, onboarding.

### The Apex Profile (MacBook Air M2 · 16GB) — unchanged
Unified memory as the superpower (8B-class local writer at q4), `memoryDirector.js` residency
ledger with per-scene model swaps, Metal `shader-f16` on every WGSL pass and ONNX session, the
predictive Thermal Oracle (learns the fanless soak curve and schedules the session around
physics), 60Hz honesty, Chrome-primary / Safari-probed dual lane, battery-aware export.

---

# PHASE Ω — THE OMEGA LAYER

> The take escapes live-action. Five sub-systems, each one gated, each one deterministic, each
> one written into the direction track so every synthetic frame is reproducible forever.

The Omega Layer is **offline-only by design.** It never touches the recording loop, never costs
a preview frame, never risks a take. It runs in the Omega scene of the Thermal Oracle: camera
off, MediaPipe and RVM unloaded, every byte and every watt handed to synthesis while the
chassis is cold. This is the one place where "offline time is free" becomes a whole product.

## Ω.1 — THE SYNTHETIC ACTOR (`studio/actor.js`)
**The camera stops being required.**

The existing procedural rig (`avatar.js`, already shipped: articulated limbs, fingered hands,
teardrop lenses, emissive web-circuit texture) is promoted from *preview puppet* to *render
target*. Any `.veyl` rig timeline retargets onto it: bone-length normalization against the
calibration profile, hip-space root motion, foot-lock IK so contact stops sliding, and a
retarget confidence track so low-visibility limbs fall back to procedural idle instead of
flailing.

What that unlocks, immediately and for free:

- **Camera-less shots.** No matte, no framing box, no 2D webcam plane. A full 6DOF camera in a
  real 3D world: wide establishing crane, low-angle hero, over-shoulder, top-down, a 180°
  orbit at arm's length. Path-traced if it's a hero frame.
- **Scale and staging.** VEYL can be 40 meters away on a rooftop edge. Live-action can never
  do that from a desk chair.
- **The performed take and the synthetic take are the same data.** One recording can be cut as
  matted footage *and* as a CG shot from another angle in the same episode — a genuine
  reverse-angle of a performance that only ever happened once, facing one way.
- **Hybrid shots.** Matted VEYL foreground, synthetic VEYL background (the Ghost Double
  finally escaping the frame edge).

Determinism: retarget parameters and camera rigs are direction-track events. Same `.veyl` +
same direction track = same frames, forever.

## Ω.2 — THE MOTION BANK (`studio/motion.js`)
**Performance without performing.**

Every take in the Vault is a rig timeline. Thousands of seconds of *your* movement, in a format
that is already normalized, already tagged with beats and gestures. That corpus is an asset no
other studio possesses, and Omega mines it.

- **Motion Matching (primary, deterministic, no ML).** The proven game-industry technique:
  index every pose in the Vault by a feature vector (trajectory, velocity, limb positions,
  gesture tag, energy band); to synthesize a new performance, query the bank for the
  best-matching continuation and blend at phase-matched points. Given a beat list — *turn,
  point at camera, recoil, settle* — it assembles a continuous, physically plausible VEYL
  performance out of your own real motion. No model, no training, no hallucination, and the
  result is unmistakably you because it *is* you.
- **Learned continuation (gated upgrade).** A small motion VAE/MLP trained *in-browser* with
  TF.js on your own rig tracks (a few MB of data — minutes of training, cached in OPFS).
  Fills gaps, generates transitions the bank lacks, and stylizes energy up or down. Seeded and
  deterministic. Never a substitute for the bank — a fallback layer under it.
- **Beat-to-blocking.** The writer's room already emits beats with emote/fx tags. Ω hands them
  to the Motion Bank, so a scripted line ships with staging attached: an entire performed shot
  from text, using motion you actually made.

Honest constraint: the Motion Bank can only speak the vocabulary you have performed. Its
quality is a function of your Vault. It is a *library*, not a dream — and it is labeled as one
in the UI, with a coverage meter per gesture.

## Ω.3 — NEURAL CINEMA (`studio/synth.js`)
**Rendered frames become photographed frames — without a video model.**

True in-browser video diffusion is not honestly available at $0 today, so Omega does not claim
it. Instead it does something verified and, for this pipeline, better: it uses the CG render as
the structural truth and SD-Turbo as a *photographic pass* over it.

- Single-step SD-Turbo img2img (ONNX Runtime Web, WebGPU, weights cached in OPFS — the same
  session the Dream Forge already loads) at low denoise strength, so geometry, silhouette and
  timing are locked by the render and only the *look* is synthesized.
- **Temporal coherence by flow, not by luck.** `flow.js` already produces per-pixel motion
  vectors. Each frame's starting latent is the previous frame's result warped along flow into
  the current frame, blended with the fresh render by an occlusion mask from the depth pass,
  plus a latent-space EMA. This is the same trick film-pipeline stylization uses and it is why
  Omega output does not boil. Fixed seed per shot; seed is a direction-track value.
- **Shot-scoped, not video-scoped.** Neural Cinema is applied per shot, at export, in thermal
  windows, with a strength slider and an A/B against the raw path-traced render.
- Fully gated on WebGPU + memory probe. Fallback: the path-traced CG shot, which is already
  beautiful. Neural Cinema is a finish, never a dependency.

Also in this pass: **2.5D novel view** (`studio/novelview.js`) — a Depth-Anything mesh from any
still (a matted performance frame, a Dream Forge backdrop, a photo) driven as real geometry
gives true parallax dollies with correct occlusion. Cheap, instant, and it turns every generated
still into a moving shot.

## Ω.4 — THE STUNT ENGINE (`studio/stunt.js`)
**Motion no body in a room can make.**

A performed rig can hand control to physics and take it back. Rapier (WebGPU/WASM, already in
the stack for compute particles) drives the suited body as an articulated ragdoll inside
**takeover windows** written into the direction track:

- A verlet web-line anchors to world geometry; the swing arc is simulated, not acted — the
  signature shot of the entire channel, finally real instead of implied.
- Impact, recoil, freefall, landing rolls: performed pose in → simulation → performed pose out,
  cross-faded at the window edges so the handoff is invisible.
- Deterministic: fixed timestep, fixed seed, simulation results cached into the direction track
  so re-renders are identical and the Reshoot Room can scrub a stunt like any other clip.

The web-swing transition stops being a camera trick and becomes an actual stunt performance.

## Ω.5 — THE EPISODE (`studio/shotlist.js`, `pages/OmegaRoom.jsx`, `.veylep`)
**The deliverable stops being a take.**

This is the inversion's payoff at the top of the stack. The Canon Engine knows the series. The
writer's room writes the scene. The Director AI has opinions about cameras. Omega adds the
missing noun: **a shot list**, and a container that holds shots from *different sources*.

- **`.veylep` episode container (v2):** an ordered list of shots, each referencing a source —
  a performed `.veyl` span, a synthetic-actor shot (rig ref + camera rig), a Motion Bank shot,
  a 2.5D still, a stunt window — plus one continuous audio spine (voice, partner, music) and
  one continuity ledger. Small, versioned, diffable, re-renderable end to end.
- **The Omega Room:** a shot-list editor beside the Reshoot Room. Every shot shows its source
  badge — `PERFORMED` / `SYNTHETIC` / `BANK` / `STUNT` / `STILL`. Reassign any shot to another
  source without losing the audio or the beat timing. Establishing shot? Synthetic. Close-up on
  the mask? Performed — always performed, because that's where the truth lives.
- **Coverage from one take.** Record one 40-second performance; ship a 6-shot episode: wide
  synthetic establisher, performed medium, reverse-angle synthetic, stunt swing, 2.5D forged
  insert, performed close-out. That is a *scene*, from one chair, in one afternoon, at $0.
- **Continuity is enforced, not hoped for.** The QA gate grows Omega rules: eyeline and
  screen-direction consistency across source switches, world/palette continuity, matte-vs-CG
  grade match, audio spine gaplessness. A shot that breaks continuity is flagged before export.
- **Honest labeling.** Synthetic shots are marked in the Vault and in the episode metadata.
  It is your character, your likeness, your motion — but the studio never lies to you about
  which frames a camera saw.

## Ω.0 — WHAT OMEGA DEMANDS OF THE SUBSTRATE
Omega is only cheap because Phase 0 exists. It adds exactly four contracts:

1. **`engine.js` gains a third clock: the *shot* clock.** Live, offline-take, offline-episode.
   Same frame graph, three clocks. Nothing else changes.
2. **`memoryDirector.js` gains the Omega scene.** Camera stack (MediaPipe, RVM, depth-live)
   fully unloaded; SD-Turbo + path tracer + Rapier resident. On a 16GB Air this is the
   *lightest* neural scene in the app, because nothing is competing with a live loop.
3. **`governor.js` Thermal Oracle gains episode scheduling.** An episode render is a queue of
   independent shots — the ideal thermal workload. Shots are ordered by cost, interleaved with
   breathers, and the queue is resumable across sessions from OPFS. A fanless machine renders
   a six-shot episode overnight at full quality.
4. **Direction track v2** carries retarget params, camera rigs, motion-bank queries, stunt
   windows, and synth seeds — so every synthetic frame is as reproducible as every performed
   one. Determinism is not a nicety here; it is the whole reason the Omega Layer is trustworthy.

## Ω BUILD ORDER (each step ships a working studio)
1. **Ω.1a Synthetic Actor, no synthesis:** retarget a stored `.veyl` onto the existing rig and
   render it from a new camera. First camera-less shot. Immediately useful.
2. **Ω.5a `.veylep` + Omega Room with two source types** (performed span, synthetic shot).
   The episode exists. One take becomes coverage.
3. **Ω.4 Stunt Engine.** The web-swing shot. The single most channel-defining frame available.
4. **Ω.2 Motion Bank (Motion Matching only).** Performance from beats, out of your own Vault.
5. **Ω.3 Neural Cinema + 2.5D novel view.** The photographic finish, gated, A/B-able.
6. **Ω.2b learned continuation**, last and optional — the only ML-trained component in the
   plan, and the only one the plan can live entirely without.

## Ω FILE MAP (new)
| File | Role |
| --- | --- |
| `studio/actor.js` | rig retarget → fully synthetic suited body, 6DOF camera-less shots |
| `studio/motion.js` | Motion Bank: motion matching over the Vault + gated learned continuation |
| `studio/synth.js` | Neural Cinema: SD-Turbo img2img + flow-warped latent feedback |
| `studio/novelview.js` | depth-mesh 2.5D parallax from any still |
| `studio/stunt.js` | Rapier takeover windows, verlet web-swing, deterministic sim cache |
| `studio/shotlist.js` | shot list model, `.veylep` container, continuity ledger |
| `studio/omega.js` | Omega conductor: scene residency, shot queue, resumable episode render |
| `pages/OmegaRoom.jsx` | shot-list editor, source badges, per-shot source reassignment |

Changed: `engine.js` (shot clock) · `memoryDirector.js` (Omega scene) · `governor.js` (episode
thermal queue) · `performance.js` (direction track v2) · `exporter.js` (episode render) ·
`qa.js` (Omega continuity rules) · `canon.js` (shot-level canon facts).

---

## HARD CONSTRAINTS HONORED (including Ω)
- **$0 forever.** MediaPipe, RVM, Depth Anything V2, Whisper-tiny, WebLLM, kokoro-class TTS,
  SD-Turbo, RNNoise, mp4-muxer, three-gpu-pathtracer, 3DGS viewers, Rapier, TF.js — all
  free/open, all cached locally after first fetch, no keys, no cloud, offline as a PWA.
- **Privacy absolute.** Raw video never leaves the machine. The Motion Bank trains on your data,
  on your device, and its weights never exist anywhere else. Duet streams rig data only.
- **Honest engineering.** No claim of in-browser video diffusion. Neural Cinema is a structural
  img2img pass with flow-based coherence — stated as such. The Motion Bank is a library of your
  own motion — stated as such. Every heavy component capability-gated with a clean fallback;
  failure degrades to today's behavior, never below it.
- **No shot lies about its origin.** Source badges in the UI, source labels in metadata.

## WHY OMEGA IS LAST AND WHY IT IS THE CEILING
Inversions 1–4 make a single take immortal, photoreal, written, and set in a manufactured
world. Omega is what you can only build *after* all four: once the performance is data, the
world is 3D, the renderer is offline, and the render is deterministic, the camera turns out to
have been optional the whole time. Nothing above this exists at $0 — because above this is a
studio, and this is a browser tab.

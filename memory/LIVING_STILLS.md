# LIVING STILLS — Phase E-S (extends CUT_PLAN.md `STILL` source)

> You hand the studio a photograph about the topic. The studio hands back a shot
> that breathes, has depth, points at what you are saying, and cuts on your voice.

Ken Burns is the floor, not the ceiling. This plan replaces the single `STILL`
recipe in `novelview.js` (heuristic depth + one dolly) with a **Living Still
pipeline**: analyse → plan motion → render through the shared grade → hand an EDL
entry to the cutter. Everything is a pure function of `(u, seed, analysis)` like
the camera rigs in `omegaStage.js`, so every still is deterministic, seekable and
re-renderable. `RECOVERY_PLAN.md` still outranks this file; the one-variable law
holds — this ships as its own controlled upload after Phase E1–E3.

---

## 0. Why stills lose viewers (diagnosis)

| Symptom on tape | Cause in the current `STILL` |
|---|---|
| Reads as a slideshow | Depth is luminance-guessed; parallax is faint and wrong on dark subjects |
| Motion is predictable | One rig (`stillCamera`): push + drift, every time, same curve |
| Nothing in the image moves | No living surface — sky, water, dust, light are frozen |
| Viewer does not know where to look | No attention direction; the whole frame moves uniformly |
| Feels pasted in | Correct grade, but no sound signature, no motion hand-off to the next shot |
| Cut is on a timer | Still ignores the speaker: no word, gaze or gesture trigger |

Every row below removes one of these.

---

## 1. Pipeline

```
image ─► ANALYSE (once, cached in the shot ref)
          ├ depth      Depth Anything V2 Small · transformers.js · WebGPU (fp16), WASM fallback,
          │            heuristic fallback (current estimateDepth) if confidence < threshold
          ├ subject    RMBG-1.4 alpha matte (rembg-webgpu) → foreground / background split
          ├ saliency   coarse attention map from depth-near ∧ high-contrast ∧ subject mask
          ├ geometry   horizon line, dominant vanishing direction, brightest cluster (light source)
          ├ semantics  tags from the beat (space, sun, ocean, city, portrait, diagram, chart)
          └ safety     faces (never warp > 2%), text regions (never crop), aspect / min-res
       ─► PLAN  (motion recipe chosen from analysis + beat + neighbours; seeded)
       ─► RENDER (Omega Stage, same GradeShader, same bloom — continuity contract)
       ─► EDL    (`cut: STILL:ref`, hold, sfx, trigger, enter/exit momentum)
```

Analysis persists as **references-only** inside the `.veylep` shot: depth as
73×129 uint8, mask as RLE, saliency as 9 floats, geometry as 6 numbers. ≈ 12 KB
per still. Re-derivation is optional; the cached analysis is authoritative so a
still renders identically on a machine with no WebGPU.

---

## 2. Layers of life (each is independently gateable; cost rises downward)

### L0 — Ken Burns done properly (`stillrig.js`)
- **Saliency-driven framing**: start and end rectangles are chosen from the
  saliency map, never centred, never the same rect twice. Two shapes: *reveal*
  (start on detail → pull to whole) and *discover* (start wide → push onto detail).
- **Speed law**: 2–5 % scale change over the hold; below 2 % is static, above
  5 % is a zoom the eye notices. Direction alternates with the previous still.
- **Curve**: asymmetric ease (fast-in 0.3 / slow-out 0.7) so the move is
  "arriving", not "drifting". Micro push-ins from CUT_PLAN §2.4s rule reuse this.
- **Speech-direction match**: notes/gestures like "look down", "out there",
  "back then" map to tilt-down, dolly-out, pull-back.

### L1 — True depth (`depth.js`, upgrades `novelview.js`)
- Depth Anything V2 Small in a Web Worker, WebGPU fp16, model cached in
  Cache Storage after first run (~50 MB once). Replaces `estimateDepth` when
  confidence passes; heuristic remains the fallback.
- **Occlusion fill**: background layer is the still inpainted under the subject
  via edge-stretch + blur (cheap, invisible at 1.4–2.4 s holds), so parallax
  never tears a halo.
- **Parallax amplitude limiter**: displacement capped by local depth gradient
  so cliffs never stretch into rubber.
- **Rack focus**: depth-of-field pass whose focal plane travels near → far (or
  reverse) across the hold. The eye follows focus; this is the strongest
  single-image attention tool that exists.
- **Depth fog / haze**: a tinted fog by depth gives instant scale to landscapes
  and space plates.

### L2 — Subject / background separation (`matte.js`)
- RMBG-1.4 matte → three planes: background (slow), subject (fast, slight
  scale-up), and a **text layer between them** — titles and readouts slide in
  *behind* the subject. This one trick is the most-shared look on the platform
  right now and it costs nothing once the matte exists.
- Subject drop shadow onto the background plane; subject rim light from the
  world's `WORLD_RIM` colour so the still belongs to the current world.
- Background duplicated, blurred and scaled 1.12× as a *bokeh backing* when the
  source aspect does not fill 9:16 — no black bars, ever.

### L3 — Living surface (`alive.js`)
Region-masked, seeded, looping displacement — a cinemagraph the studio makes
itself. Region choice comes from tags + depth + colour:
- **Sky / clouds / nebula**: slow domain-warp noise on the far-depth band.
- **Water / atmosphere**: sinusoidal displacement along the horizon normal.
- **Fire / sun / plasma**: turbulent warp + luminance flicker on the brightest cluster.
- **Stars / dust**: point sprites in depth (near ones drift faster) — dust motes
  reading as real air in front of the subject.
- **Light**: volumetric god rays radiating from the brightest cluster; anamorphic
  flare anchored to the same point, occluded by the subject matte.
- **Body**: film grain, chromatic breathing (±0.0004 CA on a 6 s sine), gate
  weave 1 px — all already half-present in `GradeShader`; expose as uniforms.

### L4 — Attention choreography (`point.js`)
The presenter points; the image answers. Each is a stateless overlay keyed to
a **depth-anchored point** so it sticks to the surface during parallax.
- **Spotlight**: everything except the subject dims 45 % and desaturates; on the
  word, the spotlight opens.
- **Magnifier lens**: circular 2.2× loupe sliding to the detail being described.
- **Draw-on**: a circle / arrow / underline animated with a hand-drawn dash.
- **Compare**: wipe or split between two supplied images (before/after, then/now,
  scale comparisons — the Sun vs Earth beat).
- **Anchored readout**: CUT_PLAN's `READOUT` numbers pinned to a depth point with
  a leader line, not floating in screen space.
- **Scale ladder**: successive images pushed back in Z as a physical stack — the
  camera flies through them ("Earth… Jupiter… the Sun…").

### L5 — Generative motion (gated, `gen.js`)
For the one *money shot* per episode: fal image-to-video (Kling v3 / Wan 2.7)
with `camera_control` and a motion-brush mask derived from the RMBG matte, 3–5 s,
requested at plan time, cached by `sha256(image + prompt + seed)`, then graded
through the same shader. Gate rules: max 1 per episode, never for faces, never
inside door/seam/CTA windows, and the deterministic L1–L3 render is the
fallback if the request misses the record time. Cost stays bounded and visible
in the Cut Room.

### L6 — Sound signature (`music.js` additions)
A still without sound is a slide. Each recipe carries: cut whoosh (direction
matched), sub-bass push on dolly-in, air/ambient bed from tags (space hum, wind,
room tone), a tick on each draw-on stroke, and a low riser under a *reveal* that
resolves on the cut back to you. Ducked under voice via the existing bus.

---

## 3. Performance-driven (the invention carried over from CUT_PLAN)

The tracker already gives head pitch, hand gestures and live word index. Add:
- **Voice-coupled dolly**: push speed follows RMS energy (louder → faster arrive).
- **Breath freeze**: a pause > 600 ms freezes the still, grain rises, focus holds;
  the next word releases it. Silence becomes a device instead of a hole.
- **Glance cut**: head pitch down > threshold → eyeline-match cut into the still
  as if you looked at it; pitch up → cut back to you.
- **Point cut**: index-finger gesture → the still enters with the spotlight
  already open on the saliency peak.
- **Word anchor**: the beat's `insert` words fire draw-ons on the exact syllable.

---

## 4. Motion grammar (enforced by the compiler)

1. Never the same recipe twice in a row; never the same move direction twice.
2. Hold 1.4–2.4 s unless the beat marks `dwell`. A dwell must earn it with a
   rack focus or a draw-on.
3. Cut *on* motion: a still exits while still moving; the next shot inherits the
   motion vector (a push becomes the actor angle's micro push-in).
4. Faces: parallax ≤ 2 %, no living-surface warp, no lens distortion.
5. Text and diagrams: no crop past the text bounds, no depth warp, spotlight and
   draw-on only.
6. One "big" effect per still (rack focus *or* god rays *or* generative), the
   rest quiet. Decoration budget is a single element.
7. Every still enters with a sound and leaves with a sound.

---

## 5. Intake UI (Studio → *Stills Tray*)

- Drop images onto a beat; analysis runs in the worker with a progress ring;
  the tray shows depth, matte, saliency thumbnails and detected safety flags.
- Recipe picker shows the **plan as an animatic** (Cut Room preview) with the
  hold, trigger and sound listed. Override per still; the compiler suggests.
- Credits field per image (source, licence) → written to the description
  alongside archival credits.
- Batch: paste 6 images → the compiler distributes them across beats by tag
  similarity and spacing rules.

---

## 6. Quality gates (tripwire.js)

- Depth confidence (variance + edge agreement) below threshold → heuristic
  fallback, flagged in the tray.
- Tear detector: rendered edge alpha > 0.5 % of frame → parallax amplitude
  halved and re-rendered.
- Face check: faces detected → grammar rule 4 enforced automatically.
- Frame-time: any recipe that drops the recorder tier in the 3-second warm-up is
  demoted to L0 for this take (same rule as archival warm decode).
- Retention-to-rule ledger: recipes are rows in CUT_PLAN's ledger; a recipe
  under an audience drop twice is demoted.

---

## 7. Phasing

| Phase | Ships | Files | Accept when |
|---|---|---|---|
| S1 | L0 saliency framing + grammar + sound signature; `STILL` uses it | `studio/stillrig.js`, `music.js`, `edl.js` | Sim take with 4 stills: no two identical moves, all holds 1.4–2.4 s, each still has enter/exit SFX, seam dHash ≤ 16 |
| S2 | L1 Depth Anything V2 worker + occlusion fill + rack focus; analysis cache in `.veylep` | `studio/depth.js`, `novelview.js`, `vault.js` | Depth model runs in worker < 900 ms/still on WebGPU; fallback path verified with WebGPU disabled; `.veylep` grows < 15 KB per still |
| S3 | L2 matte + text-behind-subject + bokeh backing; L4 spotlight + draw-on + anchored readout | `studio/matte.js`, `studio/point.js`, `stage.js` overlays | Title passes behind subject with no halo; readout stays pinned during parallax (< 3 px drift) |
| S4 | L3 living surface + performance triggers (glance, point, voice dolly, breath freeze) | `studio/alive.js`, `tracking.js`, `edl.js` | Region masks auto-selected for 3 tag classes; glance cut fires within 120 ms of pitch threshold |
| S5 | L5 generative money shot behind gate; Stills Tray batch intake; ledger rows | `studio/gen.js`, `components/studio/StillsTray.jsx`, `gate.js` | One gen clip cached and graded; falls back cleanly when offline; cost shown before record |

Controlled upload after S3 (the visible leap); S4/S5 are the second.

---

## 8. Research basis (Sept 2026)

- Depth Anything V2 Small runs in-browser via `@huggingface/transformers`
  (`onnx-community/depth-anything-v2-small`, `device: "webgpu"`, `dtype: "fp16"`),
  best in a Web Worker with a reused session.
- Subject cutout: `rembg-webgpu` / `clearcut` (RMBG-1.4) for automatic mattes;
  `sam-web` (MobileSAM / SAM2) for click-prompted masks in the tray.
- Motion craft consensus: layered 2.5D parallax, depth displacement maps,
  masked cinemagraph loops, light leaks / dust / flare as polish, and retention
  editing (short, focused holds) as the narrative constraint.
- Generative: fal exposes Kling v3 / Wan 2.7 / Veo 3.1 image-to-video with
  camera control and motion-brush masks — suitable only as a gated, cached,
  once-per-episode source.

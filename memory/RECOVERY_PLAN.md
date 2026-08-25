# SIGNAL RECOVERY PLAN — v1

> Written after the first real audience contact (7 Shorts, Aug 13–23).
> This document outranks taste. It is derived from measured data, and it is falsifiable:
> every phase ends in a number that either confirms or kills it.

---

## 0 — THE DIAGNOSIS (what the data actually said)

Measured (YouTube Studio, since published):

| Signal | Views | Stayed to watch | Avg view duration | Retention shape |
| --- | --- | --- | --- | --- |
| If The Sun Died | 943 | 13.9% | 0:13 / 0:28 (46%) | 119% spike @0:03, cliff to ~50% @0:14 |
| Real Night Sky | 222 | 9.4% | 0:14 / 0:27 (52%) | 100% @0:05, steady bleed |
| Remaining 5 | 5–28 | — | — | distribution never started |

Reading, per the doctrine's own kill-rules:

1. **The cliff is at 0–1s.** 86–90% swipe before a full sentence is spoken.
   → This is a VISUAL problem. The scripts have never actually been tested.
2. **Survivors watch ~half the video.** The interior retention is respectable.
   → The words are not the emergency. The door is.
3. **Views collapse across uploads (943 → 222 → 28 → 18 → 9 → 7 → 5).**
   → The algorithm seeded twice, watched the swipe rate, and stopped distributing.
   Channel-level trust is being spent with every upload that keeps the broken door.
4. **The 119% @0:03 means rewinds.** Something at second 3 is the strongest asset
   in the catalog. It is arriving 3 seconds too late.
5. **User's own eye test:** "behind all — space, sun, earth — seems obviously fake and 2D."
   The audience's half-second pattern-match agrees: it reads as AI slop, so they swipe
   pre-consciously, before title or hook can register.

**Verdict: stop uploading until Phase 1 + 2 are done. Every upload with the current
door burns channel trust for zero information.**

---

## 1 — THE REALISM PASS (why it looks fake, and the exact fixes)

The worlds in `frontend/src/studio/worlds.js` are honest 3D (real geometry, shader
volumes, GPU points) — but *3D geometry is not what makes footage look real*.
Phones read realism from **camera artifacts and light behavior**, not polygons.
The current output is missing every artifact a real camera would add, so the brain
files it as "render," i.e. fake, i.e. 2D — even when it is genuinely 3D.

### 1.1 Why it reads as fake (specific, in-code causes)

- **Additive-blended star points + BackSide nebula dome** = the classic "screensaver"
  signature. Everything glows, nothing occludes, no exposure response. Additive light
  with no tonemapping ceiling is the #1 CG tell.
- **No atmosphere on planetary bodies.** A sun/earth without a fresnel rim, limb
  darkening, and atmospheric scattering falloff looks like a textured ball — i.e. 2D
  sticker. Real bodies are defined by their *edges*, not their surfaces.
- **Perfect camera.** Zero handheld noise, zero parallax drift, zero focus behavior.
  A mathematically still or mathematically smooth camera screams synthetic.
- **No photographic pipeline.** No filmic tonemapping, no bloom threshold, no grain,
  no chromatic aberration, no vignette, no motion blur. Raw linear render → screen.
- **Uniform sharpness.** Everything in focus at every depth = no lens = no camera =
  not footage.

### 1.2 The fix stack (ordered by impact-per-hour, all $0, all in-stack)

1. **Filmic pipeline first (biggest single win).** ACES/AgX tonemapping, exposure
   control, threshold bloom (not glow-everything), fine animated film grain,
   subtle chromatic aberration at frame edges, vignette. One postprocessing chain,
   applied to every world. This alone converts "render" to "footage" for most viewers.
2. **Camera humanization.** Perlin-noise handheld drift (position + rotation, ~0.3Hz),
   slow push-in on every shot (nothing static, ever), micro focus breathing.
   The doctrine's Ω camera rigs carry this as direction-track params — deterministic.
3. **Atmospheric edges on all bodies.** Fresnel rim shader (scattering color by body),
   limb darkening on the sun, thin blue atmosphere shell on Earth with horizon
   falloff. The edge sells the sphere; the sphere sells the 3D.
4. **Occlusion + depth cues.** Kill additive blending on stars near bright bodies
   (real stars vanish next to a sun); depth-of-field with focus pulled to the subject;
   distant elements slightly desaturated and lifted (atmospheric perspective).
5. **The nuclear option where synthesis loses: real footage.** NASA/ESA archival
   footage is public domain. For sun/earth/ISS shots, composite the matted character
   over *actual* footage (graded to match) instead of fully synthetic worlds. Reserve
   full-3D worlds for shots real footage cannot provide (impossible cameras, anomaly
   moments). Hybrid = the Ω.5 shot-list model already supports per-shot sources;
   add `ARCHIVAL` as a source badge.
6. **Grade for horror, not for space.** Crush blacks, cool shadows, single warm
   accent. The current palettes are "pretty space." The genre is "wrong space."
   Pretty is a swipe; wrong is a hold.

### 1.3 Acceptance test (falsifiable)

Freeze-frame test: export 5 first-frames, mix with 5 real NASA stills, show to
3 people for 1 second each — "real or fake?" Pass = at least 2 of 5 renders
misidentified as real. Until this passes, Phase 3 does not start.

---

## 2 — THE DOOR (frame zero, seconds 0–3)

The scripts' six-beat structure stays. Only the opening changes:

1. **Frame zero moves.** Never a static character shot. Open ON the anomaly, already
   in motion: a number mid-change, a light mid-death, a sky mid-glitch. The character
   enters at ~0:03 — exactly where the measured 119% rewind spike lives. The data
   already told us second 3 is the magnet; make second 0 earn the way there.
2. **Burned-in English text on frame zero.** 80% watch muted. The text IS the hook.
   Short, declarative, wrong: "THE SUN YOU SEE IS 8 MINUTES DEAD."
3. **Audio within 0.5s.** A cut, a hard sound, or the first spoken word. Silence over
   a static image is a swipe instruction.
4. **Visual fingerprint per Signal.** Seven uploads currently share one thumbnail-frame
   (glowing-eyes character, dark background) — the feed reads them as one video
   reposted seven times. Every Signal's first frame must be distinguishable at
   thumbnail size. Enforce in the QA gate: perceptual-hash distance between the
   first frames of consecutive uploads must exceed a threshold.

---

## 3 — THE CONTROLLED RE-TEST (one variable: the door)

Do not write new scripts. Do not switch language. Do not change niche.
Those decisions are all downstream of a door 86% never walked through.

1. Take the strongest measured script — **the Sun Signal** (943 views, longest holds).
2. Re-render it through the Phase 1 pipeline with a Phase 2 opening.
   Same words, same beats, new door.
3. Publish as a new Short. Wait 72h minimum before reading numbers.
4. Read exactly two numbers:
   - **Stayed-to-watch:** 13.9% baseline. Target ≥ 30%. That is the confirmation.
   - **Avg view duration:** 0:13 baseline. If stayed-to-watch rises but AVD falls,
     the door improved and the words are now genuinely on trial — which is progress.
5. If confirmed: re-door the next best 4 Signals (Night Sky, Wow Signal, Space Smell,
   Bullet Speed) and resume the 48h launch cadence from the doctrine.
6. If NOT confirmed (< 20% stayed): the problem is deeper than the door —
   the character/genre premise itself is failing the half-second test. Then and only
   then, test a variant without the character in the first 3 seconds at all
   (pure anomaly footage + voice), before touching scripts or language.

---

## 4 — TRIPWIRES (decisions pre-committed, so mood can't make them later)

| Trigger (measured) | Pre-committed action |
| --- | --- |
| Re-test stayed-to-watch ≥ 30% | Door confirmed. Re-door top 5, resume cadence. |
| Re-test 20–30% | Partial. Iterate frame zero only; second re-test. |
| Re-test < 20% | Character exits the cold open channel-wide; anomaly-first format. |
| Any upload ≥ 60% stayed | Freeze that opening as the channel template. |
| 30 days post-relaunch, >70% India geo + weak RPM | Add Hindi audio track (dub, not rewrite). English stays master. |
| 30 days post-relaunch, >60% US/UK/EU geo | English-world confirmed permanently. |

## 5 — WHAT IS EXPLICITLY NOT ON TRIAL YET

- The 46 scripts (untested — the door blocked them)
- Language choice (downstream of geography data that doesn't exist yet)
- The niche / genre flip (the interior retention of survivors says it works)
- The Ω roadmap (unchanged; this plan slots realism into Phase 2's
  per-world cinematic finishing and Ω.3's photographic pass)

## 6 — ORDER OF WORK

1. Filmic post pipeline (1.2 #1–2) — every future frame benefits
2. Atmospheric edges + occlusion (1.2 #3–4)
3. Archival-hybrid source support (1.2 #5) + horror grade (1.2 #6)
4. Freeze-frame acceptance test (1.3) — gate
5. Re-door the Sun Signal (2 + 3) — publish
6. Read the two numbers. Follow the tripwire table. Nothing else.

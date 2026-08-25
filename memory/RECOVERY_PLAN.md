# SIGNAL RECOVERY PLAN — v3 (research-verified, execution-ordered)

> Written after the first real audience contact (7 Shorts, Aug 13–23).
> v2: corrected against 2026 external research on Shorts distribution,
> retention benchmarks, YPP "AI slop" policy, and CG realism technique.
> v3: corrected against deeper 2026 research on hook mechanics (first-word
> timing), loop-seam engineering, engagement-bait downranking, and IP risk —
> and against the actual code (the door data existed but nothing enforced it).
> This document outranks taste. It is derived from measured data, and it is
> falsifiable: every phase ends in a number that either confirms or kills it.

---

## v3 RESEARCH CORRECTIONS (what changed vs v2, and why)

1. **The silent 3-second door was a retention killer disguised as a hook.**
   2026 benchmark data: the algorithm's primary ranking signal is seconds 0–3;
   the strongest known retention levers are **first spoken word within 0.5s**,
   **no music-only intro**, and **captions from frame zero**. A 3-second door
   with the voice held violates the two strongest levers to protect a rewind
   spike measured once. Correction: the door becomes **VO-over-mystery** —
   line 1 fires DURING the door as disembodied voice-over the anomaly (word
   within 0.5s, burned caption at 0.0s), and the CHARACTER REVEAL lands on the
   line-2 trigger. The reveal spike is preserved; the retention levers are no
   longer sacrificed. Default door length drops 3.0s → **1.5s**, per-script
   tunable data.
2. **The end card breaks the money loop — cancelled.** The 119% spike at
   second 1–3 is loop rewatches. The documented technique for >100% AVD is
   **last frame ≈ first frame + last line sets up the first line** — hide the
   restart. A burned `shareTrigger` end card is a visible loop seam that
   announces "the video ended — swipe." `shareTrigger` is reimplemented as a
   **loop seam engine**: the auto-cut returns camera/world to the door's
   opening composition so frame-last ≈ frame-zero and the burned door text
   reads as both opening and payoff. (v2's implicit "end card" idea and any
   "first frame must differ from last frame" checklist item are reversed.)
3. **Engagement-bait burns are downranked in 2026.** Platforms suppress
   manufactured prompts ("like if…", "comment YES") and solicited pause-bait.
   Correction: `likeCta` survives only rewritten as curiosity, not command
   ("most people miss it", never "LIKE IF YOU SAW IT") — a data edit across
   scripts. `hiddenFrame` stays but is **lore, never solicited**: the glyph
   flashes, the script never mentions it. Discovery must be organic or the
   instrument becomes a downrank vector.
4. **The IP is an unmanaged existential risk.** This is a Spider-Man-adjacent
   channel. Sony/Marvel routinely revenue-claim or terminate fan-character
   channels, especially AI-generated ones. Survival requirements: original
   (non-traced) suit design, explicit fan-made/parody labeling, the AI-content
   disclosure flag on every upload, zero official footage/music/logos, and no
   revenue projections built on claimed-at-will income. This is Phase 0 —
   before anything ships.
5. **One-size door = template sameness = the exact YPP risk v2 identified.**
   The scripts' own `frameZeroShot` data specifies six distinct opening
   grammars (mask snaps, whip-pans, cold worlds, prop reveals…). A single
   blanket "hide the character" door would betray the scripts AND recreate the
   seven-identical-first-frames failure. Correction: the door engine is a
   **shot interpreter with a six-move vocabulary**, tagged per script.
6. **Code audit finding: the door was data-only.** `frameZero`/`likeCta` exist
   on all 46 scripts, but nothing enforced them at record time — the character
   was still visible from frame zero, no burned text, no audio structure.
   The take engine (Phase A) closes this, and pulls `hiddenFrame` and the
   loop seam out of "deferred."
7. **Confirmed and kept from v2:** 48h cadence is fine (upload frequency is
   not a ranking factor; per-video seed tests are); <20–25s runtime is the
   loop sweet spot; faceless AI channels remain YPP-eligible when each video
   shows editorial judgment — which the six-move vocabulary provides.

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
   → The algorithm seeded twice, watched the swipe rate, and stopped
   distributing. Channel trust is spent by every upload with the broken door.
4. **The 119% @0:03 means rewinds/loops.** The strongest asset in the catalog
   lives at second 3 — and (v3) at the loop seam. Protect both.
5. **User's own eye test:** "behind all — space, sun, earth — seems obviously
   fake and 2D." The audience's half-second pattern-match agrees: it reads as
   AI slop, so they swipe pre-consciously.

**Verdict: no uploads until Phase A + B are done. Every upload with the
current door burns channel trust for zero information.**

---

## PHASE 0 — IP SURVIVAL (new in v3; before anything ships)

1. Every upload description carries "fan-made parody" language. Non-negotiable.
2. The AI-generated-content disclosure flag is set on every upload.
3. Verify the suit design is original — not traced from any official design.
   If it is close, iterate it away. The character is "a masked figure",
   never named as the trademark in titles/descriptions/tags.
4. Zero official footage, music, logos, or clips. NASA/ESA archival is public
   domain and stays; anything Sony/Marvel does not.
5. Accept revenue-claim risk as a cost of the niche. No plan, tripwire, or
   projection may assume unclaimed monetization.

---

## 1 — THE REALISM PASS (built; kept from v2)

Status: **implemented** — filmic pipeline (ACES, threshold bloom, grain, CA,
vignette, log depth), handheld breathing rig, black-body photospheres,
Rayleigh+Mie atmosphere shells, OKLab gradients, star-glare occlusion,
archival-hybrid source support, horror grade. See §7 status table.
Full v2 technical rationale preserved in git history; the falsifiable gate
remains:

### 1.3 Acceptance test (gate — NOT yet run)

Freeze-frame test: export 5 first-frames **through the new door engine**
(old frames test the wrong thing), mix with 5 real NASA stills, show to
3 people for 1 second each — "real or fake?" Pass = at least 2 of 5 renders
misidentified as real. Until this passes, Phase C does not start.
If it fails: fix worlds, not scripts.

---

## 2 — THE DOOR (seconds 0–3) — v3 design

The scripts' six-beat structure stays. The opening becomes an enforced,
per-script choreography:

1. **VO-over-mystery, not silence.** Burned hook text (`frameZero`) at 0.0s.
   Hard sound (`music.impact`) at t=0. **First spoken word by 0.5s** — line 1
   plays as voice-over while the character is withheld/obscured per the
   script's door move. The character reveal + score entry + punch land
   together at `doorSec` (~1.5s default), on the line-2 trigger — the
   measured rewind magnet, now arriving with the groove.
2. **Six door moves, tagged per script (`doorMove`)** — the anti-template
   vocabulary, distilled from the scripts' own `frameZeroShot` directions:
   | Move | Engine behavior 0→doorSec | Serves |
   | --- | --- | --- |
   | `COLD_WORLD` | Character hidden, anomaly-only, slow push | world-first cold opens |
   | `MASK_SNAP` | Extreme close framing, eyes-up snap at ~0.4s | mask close-up openings |
   | `WHIP_PAN` | 0.3s camera whip + glitch landing on subject | mid-motion catches |
   | `GLITCH_CUT` | 2-frame hard glitches, resumes mid-motion | broken-transmission opens |
   | `PROP_REVEAL` | Tight on a detail (readout/hand), pull to subject | number/object hooks |
   | `DIM_WORLD` | World param animated through the door | dying-light anomalies |
3. **Loop seam (replaces the end card).** The auto-cut returns camera/world
   to the door's opening composition: last frame ≈ first frame, last line
   feeds the first line, restart invisible. This is the engine of >100% AVD.
4. **Hidden frame = unsolicited lore.** 2–3 frame glyph+text insert at the
   script's stated second. Never referenced in speech or CTA.
5. **Soft CTA only.** `likeCta` fires on its own overlay plane at its measured
   second, ~1s, curiosity-phrased. Command phrasing is rewritten in data.
6. **Visual fingerprint per Signal (kept from v2, now enforced).** dHash
   distance between consecutive uploads' first frames must exceed threshold;
   warn when consecutive uploads share BOTH `worldKey` and `doorMove`.
   Additionally the gate now checks first-vs-last frame of the SAME take for
   SIMILARITY (loop seam verification) — difference across uploads,
   similarity across the seam.

---

## PHASE A — THE TAKE ENGINE (code; this branch; last code gap)

### A1. `studio/scripts.js` (data only — words/beats untouched)
- Add `doorMove` tag to all 46 scripts (from their `frameZeroShot` text).
- Add optional `doorSec` (default 1.5).
- Rewrite command-phrased `likeCta` lines to curiosity phrasing.

### A2. `studio/door.js` (new) — the six door moves
Each move is a small driver over existing instruments (handheld rig targets,
`punch`, `glitch`, emote snaps, world params). Interface:
`arm(script, stage, rig)` → per-frame `update(el)` → `resolve()` at reveal →
`abort()` for any exit.

### A3. `studio/stage.js` — overlay module + actor visibility
- `setActorVisible(on)`: stored flag, applied at layer creation inside
  `start()` (layers are lazy — an early-armed door must not leak the
  character into frame zero) and on any rebuild path.
- Overlay planes (own canvases, camera-anchored, renderOrder 1001+, ZERO
  contact with the karaoke caption clock — protects `captionRemaining()` and
  the auto-cut):
  - `burn(text)` / `clearBurn()` — frame-zero hook, 800-weight condensed,
    backing bar, 60–70% down (above the karaoke lower-third; can't collide).
  - `flashCta(text)` — soft CTA, self-clearing ~1s, never queued.
  - `insert(spec)` — hiddenFrame glyph+text flash, generic renderer
    (covers ~40/46 inserts; rest fall back to glyph-only).
- Every clear path wipes all overlay planes — uploads and live preview can
  never carry stray burned text.

### A4. `pages/Studio.jsx` — choreography on the recorder's clock
- **Arm** (in `startRecording`, when script has `frameZero`): door state
  `{ closed, doorSec, move, ctaFired }`; `setActorVisible` per move;
  `overlay.burn(frameZero)`; `music.impact()` at t=0; riser peaking at
  reveal; **score deferred to reveal**.
- **During door** (per-frame loop): `door.update(el)`; voice RUNS (v3 —
  VO-over-mystery; the performer speaks line 1 immediately); beat clock
  offset on `rec.elapsed − doorSec` (recorder time, drift-proof; all 46
  scripts' timings shift untouched).
- **Reveal frame** (`rec.elapsed >= doorSec`): clearBurn → `door.resolve()`
  → `punch` + `glitch` + `impact` + `startScore` → beat-0 emote with
  expression snap.
- **CTA:** at `doorSec + likeCta.atSec`, `flashCta` once. Own plane; never
  delays the auto-cut.
- **Loop seam:** schedule return-to-opening-composition over the final ~0.8s
  before the known auto-cut time.
- **`closeDoor()`** on every exit path (stop, recorder-offline fallback,
  countdown cancel, unmount) — the preview can structurally never strand
  door-closed or text-burned.
- Freestyle takes (no `frameZero`): nothing changes.

### A5. `studio/gate.js` / `/gate`
- Cross-upload dHash warning when consecutive uploads share `worldKey` +
  `doorMove`.
- Same-take seam check: first/last frame dHash similarity = loop verified.
- Static pre-publish checklist panel (see Phase C).

### A6. Acceptance (all falsifiable)
1. Sim mode, Sun Signal (`MASK_SNAP`): burned text at 0.0s, impact at t=0,
   line 1 VO by 0.5s, reveal + groove + punch at ~1.5s, CTA flash at its
   second, auto-cut with no added dead air, last frame ≈ first frame.
2. Scrub the file at each `hiddenFrame` second → find the glyph.
3. Freestyle take unchanged; character visible frame one; score at t=0.
4. Abort mid-door (Space / recorder-offline / countdown cancel) → preview
   recovers, zero stray text.
5. Lint/build passes; `/gate` re-run on new first frames.

---

## PHASE B — THE HUMAN GATE (no code; cannot be skipped)

1. Export 5 first-frames through the new engine.
2. Run §1.3 with 3 real people. Pass ≥2/5 misidentified as real, or fix
   worlds and repeat. **Phase C is locked until this passes.**
3. Run the dHash fingerprint check across the 5 planned uploads.

---

## PHASE C — THE ONE UPLOAD (controlled re-test; one variable: the door)

Do not write new scripts. Do not switch language. Do not change niche.

1. Record the **Sun Signal** ("IT MIGHT BE GONE", `MASK_SNAP`) — same words,
   same beats, new door. Multiple takes; pick by eye.
2. Pre-publish checklist (enforced in `/gate`, not remembered):
   - burned text legible at 360px width
   - first spoken word ≤ 0.5s; audio at t=0
   - runtime ≤ 25s
   - loop seam verified by scrubbing (last frame ≈ first frame)
   - fan-made parody label + AI disclosure flag set
   - no command-phrased CTA anywhere
   - title is not the hook text verbatim (no redundancy tax)
   - file plays outside the browser
3. Publish. **Then stop. Nothing else for 72h minimum** — every extra upload
   before the read burns seed-trust for zero information.

---

## PHASE D — THE READ (72h; the entire point)

Enter exactly two numbers into `/retest`: stayed-to-watch and AVD.
v3 adds external benchmarks alongside the self-relative targets:
swipe-away 0–3s <15% = exceptional, >35% = failure; VVSA healthy band
70–90%, <60% = distribution collapse; retention >100% at second 1 = loop
seam working.

## 4 — TRIPWIRES (decisions pre-committed, so mood can't make them later)

| Trigger (measured) | Pre-committed action |
| --- | --- |
| Re-test stayed-to-watch ≥ 2x channel median (≥ ~25%) | Door confirmed. Re-door next 4 (Night Sky, Wow, Space Smell, Bullet Speed — each with a DIFFERENT `doorMove`), resume 48h cadence. |
| Re-test 1.3–2x median (~16–25%) | Partial. Iterate frame zero only — a `doorSec`/`doorMove` DATA edit, no code — second re-test. |
| Re-test < 1.3x median (< ~16%) | Character exits the cold open channel-wide: `COLD_WORLD` becomes the default move. The engine already supports it — no rewrite. |
| Any upload swipe-away > 35% in first 3s | Past the failure line — iterate from strength. |
| Any upload swipe-away < 25% in first 3s | Healthy. Freeze that opening as the channel template (move + doorSec). |
| Rolling baseline | Recompute channel median over last 20 Shorts after every 5 uploads; all tripwires re-base. |
| 30 days post-relaunch, >70% India geo + weak RPM | Add Hindi audio track (dub, not rewrite). English stays master. |
| 30 days post-relaunch, >60% US/UK/EU geo | English-world confirmed permanently. |
| Any IP claim/strike | Stop uploads; assess; parody labeling review. Never dispute reflexively. |

## 5 — WHAT IS EXPLICITLY NOT ON TRIAL YET

- The 46 scripts' words and beats (untested — the door blocked them)
- Language choice (downstream of geography data that doesn't exist yet)
- The niche / genre flip (interior retention of survivors says it works)
- The Ω roadmap (unchanged)
- Any second code project before Phase D reads its numbers

## 6 — ORDER OF WORK (v3)

1. Phase 0 — IP survival checklist (labels, disclosure, suit originality)
2. Phase A — the take engine (A1–A6); the last code gap
3. Phase B — human freeze-frame gate on new-engine frames — HARD GATE
4. Phase C — one upload: re-doored Sun Signal + enforced checklist
5. Phase D — 72h, two numbers, tripwire table. Nothing else.

## 7 — IMPLEMENTATION STATUS

| Plan section | Instrument | Where | Status |
| --- | --- | --- | --- |
| 1.2 #1–2 filmic pipeline + handheld | ACES/log-depth/grain/CA/vignette + breathing rig | `studio/stage.js`, `studio/handheld.js` | DONE |
| 1.2 #3–4 atmospheric edges + occlusion | Black-body photospheres, Rayleigh+Mie shells, OKLab gradients, glare fade | `studio/worlds.js` | DONE |
| 1.2 #5 archival hybrid + #6 horror grade | Archival source + grade uniforms | `studio/archival.js`, `studio/stage.js` | DONE |
| 1.3 + 2 #6 the gates | Freeze-frame tester + dHash fingerprint | `/gate` | DONE (tool) / NOT RUN (human test) |
| 2 the door — data | `frameZero`/`likeCta`/`hiddenFrame` on all 46 scripts | `studio/scripts.js` | DONE (data) |
| 2 the door — ENGINE | Six-move door, overlay burns, VO-over-mystery, voice/beat choreography, loop seam, hiddenFrame inserts | `studio/door.js` (new), `studio/stage.js`, `pages/Studio.jsx` | **TODO — Phase A** |
| 2 #3 loop seam + A5 gate checks | Return-to-open composition + seam dHash + pre-publish checklist | `Studio.jsx`, `/gate` | **TODO — Phase A** |
| Phase 0 IP survival | Labels, disclosure, originality audit | upload process (human) | **TODO** |
| 3 + 4 re-test + tripwires | Upload ledger, 72h seal, rolling median, geo tripwires | `/retest` | DONE (tool) / NOT RUN |

The numbers themselves (stayed-to-watch, AVD, swipe-away, geography) are
entered by hand from YouTube Studio — the ledger never pretends to have
API access it doesn't. Same numbers in, same decision out, forever.

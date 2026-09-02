# THE CUT ENGINE — PHASE E (the middle 18 seconds)

> The door (Phase A) fixed seconds 0–1.5. The loop seam fixed the last 0.8s.
> Between them the audience watches ONE medium shot of one character for ~18
> seconds. Rule #8 of the channel's own `VIRAL_RULES` ("change what the eye
> sees every 2 seconds") is data nobody enforces — exactly the same failure
> mode v3 found in the door. This plan makes the studio an EDITOR, not just a
> camera: every take comes out already cut, with B-roll, angles, kinetic
> numbers and sound design, deterministically, from the script's own beats.
> $0, in-browser, live on the recorder's clock, reproducible forever.

Relationship to the other plans: `RECOVERY_PLAN.md` still outranks this one
on sequencing (§7 below). `TERMINAL_PLAN.md` Ω stays the ceiling; Phase E is
the bridge — it is the first time the Omega sources (archival, 2.5D, synthetic
actor, camera rigs) appear INSIDE a live take instead of in a separate room.

---

## 0 — THE DIAGNOSIS THE DOOR DID NOT COVER

| Measured | Reading |
| --- | --- |
| Survivors watch ~46–52% (AVD 0:13–0:14 of 0:27) | Interior retention is "respectable" but HALF the video is lost by people who already chose to stay |
| Cliff at 0:14 on the best performer | Beats 13–17 ("payoff" + "story") play on a frame that has not changed since 1.5s |
| 119% @0:03 | The only rewind magnet is the reveal — the one moment the frame changes hard |
| User eye-test: "obviously fake and 2D" | A single unbroken CG shot is the easiest thing to pattern-match as CG. Real cutaways break the match |

The scripts already know this. Beat notes say "Change the shot here" (S01 beat
6), "Glance down at Earth" (S01 beat 3), "Point down" (S02 beat 3), "THE TURN.
Dead stop." (every script, beat 9). Every director note is an edit instruction
that currently goes to the teleprompter and nowhere else.

**Thesis: the frame must change on a beat, on a word, or on a look — never on
a timer, never at random — and every change must be one of five honest
sources the studio already renders.**

---

## 1 — THE FIVE CUT SOURCES (all exist; none are new tech)

| Source | Badge | Instrument already in code | What it looks like |
| --- | --- | --- | --- |
| **Angle** | `PERFORMED` | `omegaStage.js CAMERA_RIGS` (wide/medium/close/reverse…), live rig from `tracking.js` | The same live performance from a different virtual camera — a real cut in a 3D scene. One webcam = free multicam |
| **World punch** | `PERFORMED` | `worlds.js` bodies (photospheres, Earth, Mars, station), `stage.js punch()` | Actor exits frame; camera dives into the THING being talked about (the sun, Earth's terminator). The world becomes the B-roll |
| **Archival** | `ARCHIVAL` | `archival.js` (video plane + rostrum camera + shared grade) | Real NASA/ESA/SDO footage. Public domain. The strongest anti-"AI slop" instrument that exists |
| **Still 2.5D** | `STILL` | `novelview.js` (depth-mesh parallax dolly), `public/gate/real-*.jpg` | A real photograph with true parallax. Reads as a moving shot. Instant, ~0 bytes |
| **Readout** | `INSERT` | `stage.js insert()` (the hiddenFrame renderer) generalized | Kinetic number / clock / speed readout / glyph — the "8 MINUTES" that counts up on the word "8" |

The sixth, later: **Synthetic reverse** (`actor.js` renders the live rig from
behind/beside — the Ghost Double escaping the frame). Ω.1 already does this
offline; live it needs the rig retarget at frame rate — gated, last.

---

## 2 — THE EDIT GRAMMAR (data, deterministic, per beat)

### 2.1 Script schema additions (`scripts.js`, data only, words untouched)
```
B(6, 'So the light on you right now is 8 minutes old.', 'narrow', 'none',
  'New thought. Change the shot here.',
  { cut: 'ANGLE:close', on: 'beat' })

B(3, 'Sunlight takes 8 minutes to reach your face.', 'scan', 'none',
  'Glance down at Earth on "your face".',
  { cut: 'WORLD:sun>earth', on: 'word:"your face"', hold: 1.6, back: 'ANGLE:medium' })

B(9, 'If the sun died this second, nothing could warn you. Nothing.', 'shock', 'pulse',
  'THE TURN.',
  { cut: 'TURN' })   // the named macro: freeze 3f + burn + bass drop + hold lens, NO cutaway
```
- `cut` — `SOURCE:ref`. Sources: `ANGLE`, `WORLD`, `ARCHIVAL`, `STILL`, `READOUT`,
  `TURN`, `NONE` (explicit hold, for beats that must stay on the mask).
- `on` — the trigger: `beat` (beat clock), `word:"…"` (recognition word index
  from `spideyVoice.js`), `look:down|up|lens` (§3), `gesture:point|raise` (§3).
- `hold` — seconds on the cutaway (default from source: archival 1.8, still 1.4,
  readout 1.0, world 1.6). `back` — where to return (default: previous angle).
- `readout: { value: '8', unit: 'MINUTES', style: 'count|roll|clock|flicker' }`.

### 2.2 The Beat-to-Edit Compiler (`studio/edl.js`) — when `cut` is absent
Most scripts will NOT be hand-tagged at first. The compiler derives a cut from
data already present, by fixed rule order (first match wins, seeded tie-break):

1. `emote === 'shock'` → `TURN`. Always. Never a cutaway on the turn.
2. Note contains `glance|look|point` + a world noun (sun, earth, moon, star, sky, ground) → `WORLD:<noun>` on the quoted word if present, else on beat.
3. Beat text contains a number with a unit (regex: `\d+ (minutes|seconds|km|kilometres|years|degrees|times|spoons?)`) → `READOUT` on that word, `count` style.
4. Note contains `change the shot|new thought|stack it` → `ANGLE:<next tighter rig>`.
5. Script `tags` ∩ archival manifest subjects, and no archival used yet in this take → `ARCHIVAL:<subject>` (§4) on beat.
6. Beat 17 (`Story:`) → `ANGLE:close` and `NONE` after — the story is always performed, on the mask.
7. Otherwise → `NONE`.

Then the **2.4-second rule pass**: walk the EDL; any span > 2.4s with no change
gets a `MICRO` — an 8% push-in on the current angle (`handheld.js` target,
0.35s ease). It is the smallest honest change and it is invisible as a cut.

Then the **protected windows**: no cut inside `[0, doorSec]` (the door owns it),
no cut inside the seam `[T−0.8, T]`, no cut within 0.6s of the CTA flash, no
cutaway that would cover the `hiddenFrame` second. `MICRO` is allowed in the
seam only if it lands on the opening composition (it never is; the seam wins).

Output: an **EDL** — `[{ t, trigger, source, ref, hold, back, sfx, seed }]` —
a pure function of `(script, seed, archivalManifest)`. Same inputs, same cut.
The EDL is written into the direction track (Ω direction track v2) so the
Reshoot Room re-renders it identically.

### 2.3 Cut mechanics (`studio/cutter.js`) — how a cut physically lands
- **Only on a closed mouth.** Same law as the auto jump-cut: a cut waits up to
  180ms for `jaw < threshold`; the seam is invisible because the mask never
  mid-word-pops. If the wait expires, the cut lands anyway (rule #8 outranks).
- **J-cut by default.** Audio is continuous (one MediaRecorder track; we never
  touch it). Video changes 120ms AFTER the trigger word starts — the documentary
  grammar: hear it, then see it. `TURN` is the exception: picture and sound
  land together.
- **Every cut has a sound.** `music.js` gains `cutSfx(kind)`: `whip` (angle),
  `sub-thump` (world punch), `film-click + air` (archival), `tick` (readout),
  `impact` (turn — already exists). Silent cuts read as glitches; audible cuts
  read as editing. −18 dBFS under the voice, ducked by the existing comp.
- **Two transitions only.** Hard cut (default) and the existing `WHIP_PAN`
  door move repurposed as a 0.3s transition for `ARCHIVAL` in/out. No dissolves
  (they read as slideshow), no wipes, no zoom-blur presets.
- **Shared grade.** Every cutaway rides the same composer chain (bloom, grain,
  CA, vignette, horror grade). `archival.js` already documents this as "the
  whole trick" — this plan makes it the rule for all five sources.
- **The seam still wins.** `cutter.abort()` on every exit path `closeDoor()`
  already touches; the seam ramp forces `back: door composition`.

---

## 3 — CUTS DRIVEN BY THE PERFORMANCE, NOT THE CLOCK (the invention)

The tracker already produces head pitch/yaw and hand landmarks at frame rate.
Today they only drive the puppet. Phase E lets them drive the EDITOR.

- **LOOK-CUT.** When `on: 'look:down'` is armed for a beat and the live head
  pitch crosses −18° for 4 frames, the cut fires — to the world object the
  performer looked at. The audience sees VEYL glance down, then sees Earth.
  This is eyeline-match editing, the oldest trick in cinema, performed live
  by the performer's own neck. Armed windows only (the beat's span), so a
  random look cannot fire it. Falls back to `on: 'beat'` at span end if the
  look never comes.
- **GESTURE-CUT.** `point` (index extended toward lens, other fingers curled,
  from `HandLandmarker`) → `READOUT` insert or `ANGLE:close`. `raise` (wrist
  above shoulder) → `WORLD` punch. Same arming rule. `perf.js` already names
  the gesture vocabulary (`GESTURES`); this wires it to the cutter.
- **Voice-cut.** `spideyVoice.js` fuzzy alignment gives a live word index;
  `on: 'word:"…"'` resolves to it. The readout counts up ON the number, not
  0.4s after. This is the difference between "edited" and "captioned."
- **Silence-cut.** The auto-jump-cut already detects line ends. A pause
  > 0.6s inside a beat with an armed `ARCHIVAL` promotes the archival cut to
  fire now (the pause becomes a breath over real footage instead of dead air).

Determinism note: performance-triggered cuts are recorded into the direction
track as the ACTUAL time they fired. Re-render is exact. Pre-visualisation in
the Cut Room (§5) shows the nominal time and the arming window.

---

## 4 — THE ARCHIVAL MANIFEST (the B-roll library, $0, legal, offline)

`public/archival/manifest.json` + files, curated once, cached by the PWA:

- **Sources:** NASA (public domain), ESA (CC BY 4.0 — attribution required,
  already the practice in `textures/real/CREDITS.txt`), SDO/SOHO (NASA), ISS
  HD Earth Viewing (NASA), JWST/Hubble (NASA/ESA/STScI, PD or CC BY).
  Zero Sony/Marvel, zero stock, zero YouTube rips. Phase 0 IP rules apply.
- **Shape:** ~40 clips at 1080×1920 crop (or 1080×1080 letterboxed inside the
  vertical frame with the world visible around it — the "window" composition,
  a strong hybrid look), ≤ 6s each, ≤ 6 MB, H.264 mp4 for decode speed.
  ~40 stills 1080×1920 for `STILL`.
- **Tags:** `subject` (sun, earth, moon, iss, mars, nebula, blackhole, rocket,
  asteroid, aurora, eclipse, milkyway), `motion` (static, slow, fast),
  `energy` (calm, urgent), `credit`, `licence`, `dhash`.
- **Selection:** compiler rule 5 picks by `script.tags ∩ subject`, prefers
  `energy` matching `script.mood`, never reuses a clip within one take, and
  rotates across takes by seed so consecutive uploads never share B-roll
  (the same anti-template law the door enforces via dHash).
- **Warm decode:** every clip the EDL will use is `createFootageView`-ed and
  seeked to 0 BEFORE the countdown ends, so the cut is frame-exact. Budget:
  ≤ 3 archival clips per take (memory + honesty — too much B-roll and the
  character disappears from his own channel).
- **Description credits:** the upload description auto-appends the credit
  lines for every archival source used (gate checklist item).

---

## 5 — THE CUT ROOM (`pages/CutRoom.jsx`) — see the edit before you perform it

A timeline for one script, generated from the EDL, no recording needed:
- Beat lanes with the cut source badge on each change, colored by source.
- The **2.4s coverage bar**: green where the frame changes in time, red spans
  where it does not (should never be red after the compiler runs; it is a
  falsifiable proof the rule holds).
- Arming windows for look/gesture/word triggers drawn as brackets.
- Click any cut → override (`cut`, `hold`, `on`, or `NONE`) → persisted as a
  per-script override in the vault (data, never code). Re-seed button.
- **Preview scrub:** the omega stage plays the EDL in SIM mode (procedural
  rig) with the real cutaways — a full animatic of the edit in 20 seconds.
- Honest badges everywhere; `ARCHIVAL` cuts show credit and licence.

The Studio gains one control: `CUT: AUTO | OVERRIDES | OFF`. `OFF` is the
Phase C door-only take. This is how the plan stays one-variable (§7).

---

## 6 — THE EDITOR THAT LEARNS FROM THE AUDIENCE (no ML, one ledger)

YouTube Studio gives a per-second retention graph. `/retest` today takes two
numbers. Phase E adds a third input: the **drop seconds** (type the 1–3 seconds
where the graph falls hardest). The ledger then does something no editor can:

- Map each drop second → the beat → the EDL entry that was on screen → the
  compiler RULE that produced it.
- Keep a rule scoreboard across uploads. A rule that sits under a drop twice
  in a row is **demoted** (the compiler skips it; the Cut Room shows it greyed
  with the evidence). A rule that sits under a rewind spike twice is promoted
  (tried first). `scripts.js killRule` already states this law for words;
  this applies it to cuts.
- Same protection as the tripwires: nothing changes automatically until the
  72h read; the operator confirms the demotion. Same numbers in, same edit
  out, forever.

---

## 7 — WHEN (sequencing against RECOVERY_PLAN v4)

RECOVERY §5: "no further code before Phase D reads its numbers." Honored, with
one precise exception that keeps the re-test one-variable:

1. **Phase C ships with `CUT: OFF`.** The re-doored Sun Signal tests the door
   and only the door. Nothing here touches that upload.
2. **Phase E code may be BUILT during the 72h Phase D seal** — the seal
   forbids uploads, not work — behind the `OFF` default, with zero changes to
   the door/seam/recorder paths except `cutter.abort()` joining `closeDoor()`.
3. **Phase E ships as the SECOND controlled upload**, after Phase D's read,
   on a different script with a different `doorMove` (tripwire row 1 already
   schedules four re-doored signals — the first of them carries `CUT: AUTO`).
   Read: interior AVD (13→17s retention) is the number on trial. Target: the
   0:14 cliff flattens; survivors' AVD > 60%.
4. If Phase D fails the door (< 1.3x median), Phase E still proceeds — the
   door tripwire changes the door to `COLD_WORLD`; the cut engine is
   orthogonal. The two instruments never share a variable.

---

## 8 — BUILD ORDER (each step leaves a working studio; each has a gate)

| # | Step | Files | Gate (falsifiable) |
| --- | --- | --- | --- |
| E1 | `edl.js` compiler + `ANGLE` cuts only + cut SFX + closed-mouth landing + protected windows | `studio/edl.js`, `studio/cutter.js`, `studio/music.js`, `pages/Studio.jsx` (arm/update/abort beside `door`) | Sim-mode Sun Signal: ≥ 6 angle changes 1.5–20.2s, none inside door/seam/CTA, seam dHash still ≤ 16, zero stray state after abort |
| E2 | `READOUT` kinetic numbers on `word:` triggers | `stage.js` (generalize `insert()` → `readout()`), `edl.js` rule 3, `spideyVoice.js` word index hook | "8 MINUTES" counts up within 120ms of the word "8" on a live-mic take |
| E3 | `WORLD` punches + LOOK-CUT | `cutter.js`, `worlds.js` (named focus targets per body: `focus('earth')`), `tracking.js` (expose smoothed pitch) | Glance down in live mode → Earth on screen within 6 frames; no fire outside the armed window in a 60s idle test |
| E4 | Archival manifest (40+40) + `ARCHIVAL`/`STILL` cuts + warm decode + credits | `public/archival/*`, `archival.js`, `novelview.js`, `gate.js` checklist | 3-clip take records with no dropped frames (recorder tier unchanged); credits present in description; dHash across two takes' B-roll differs |
| E5 | Cut Room + overrides + coverage bar + `CUT` toggle | `pages/CutRoom.jsx`, `studio/vault.js` | Coverage bar shows zero red spans on all 46 scripts under AUTO |
| E6 | Retention-to-rule ledger | `studio/tripwire.js`, `pages/RetestRoom.jsx` | Enter 3 drop seconds → the correct beat/rule is named; second strike demotes with evidence |
| E7 | GESTURE-CUT, `TURN` macro polish (3-frame freeze + burn), direction-track write | `cutter.js`, `perf.js` | Reshoot Room re-renders a cut take pixel-identical at cut frames |
| E8 (gated) | Live synthetic reverse angle from `actor.js` | `actor.js`, `omegaStage.js` | 30fps sustained on the Apex profile with the reverse rig live, else stays OFF |

Out of scope: any change to words/beats, the voice chain, recorder tiers, the
door moves, or the seam. Audio is never cut — one continuous spine.

---

## 9 — HARD CONSTRAINTS (inherited, plus Phase E's own)

- **$0, in-browser, offline.** Manifest cached by the PWA; no API, no cloud.
- **Honest.** Every cutaway carries its source badge in metadata; archival
  credits are mandatory in the description; the character is never replaced by
  B-roll for more than 40% of a take (compiler hard cap) — this is his channel.
- **Deterministic.** EDL = f(script, seed, manifest). Fired times recorded.
- **Never below today.** `CUT: OFF` is byte-identical to the current studio.
  Any cutter failure → `abort()` → the take continues on the medium shot.
- **One variable per upload.** The door and the cut are never tested together
  for the first time.
- **IP.** NASA/ESA only. No franchise footage, music, or logos — ever.

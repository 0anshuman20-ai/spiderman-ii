# THE VIRAL STACK — Phase V (everything outside the frame)

> RECOVERY_PLAN owns 0–3s and the seam. CUT_PLAN owns the middle 18s.
> LIVING_STILLS owns what a topic image does on screen. Together they make
> *one* video good. This plan is about making **every** video good — the
> systems that run before the take is shot and after it is exported.
> Same constitution: no engagement-bait (downranked in 2026), references
> only, deterministic, one variable per upload on the main channel.

The unit of work here is not the video. It is the **loop**:
`promise → payoff → seam → promise`. Everything below either sharpens the
promise, protects the payoff, or shortens the distance between uploads.

---

## 0. Diagnosis — what "viral every time" actually requires

Nobody gets 100%. What the channels that *look* like they do have is:

1. **A repeatable promise shape** — the viewer knows within 0.5s what kind of
   question this is and that it will be answered.
2. **A payoff that lands late** — the answer sits in the last 15%, so the loop
   seam replays the promise instead of a dead frame.
3. **Density with no dead seconds** — something new for the eye *or* the ear
   *or* the mind every ~2.4s. (CUT_PLAN covers the eye. Ear and mind are here.)
4. **A brand you can hear** — recognition before comprehension.
5. **A comment reason that is not a request** — a true claim people want to
   argue with or add to.
6. **Volume with variance** — many uploads, each differing in one measured way,
   so the ledger learns something every time.

---

## 1. PROMISE ENGINE (`studio/promise.js`) — the script's skeleton, scored

Every script gets a machine-readable **promise contract** (data on
`scripts.js`, words untouched):

```js
promise: {
  kind: 'NUMBER' | 'IMPOSSIBLE' | 'HIDDEN' | 'SCALE' | 'MISTAKE' | 'DEADLINE',
  question: 'how long the Sun has been lying to you',   // what frameZero implies
  payoffBeat: 9,        // beat index where the answer lands (must be ≥ 80% in)
  openLoops: [          // secondary hooks planted early, closed later
    { plant: 2, close: 7 },
  ],
  turn: 6,              // the "wait, what?" reversal (CUT_PLAN's THE TURN)
}
```

Rules the compiler enforces (`gate.js` refuses to arm the take otherwise):

- **Payoff ≥ 80%.** Answering early is the #1 mid-roll cliff after the door.
- **One open loop minimum**, planted before 30%, closed after 60%. Gives the
  viewer a second reason to stay after the first curiosity is spent.
- **Turn between 40–60%.** The middle of the video must contain a reversal,
  not more evidence.
- **Promise/payoff symmetry.** The last spoken line must reference a word from
  `frameZero`, so the seam restarts on a resolved chord.
- **No question stacking.** One question per 20s. Two competing questions test
  as "confusing" in every 2026 hook study.

**Promise families → door moves.** Each `kind` maps to one of the six door
moves already in `door.js`, so the door is derived, never chosen by mood.

**Pacing meter (teleprompter).** Live words-per-second against a 2.8–3.4 band;
a lane turns amber when the operator drifts. Under 2.6 wps in the first 5s is
the single most predictive slow-start signal.

---

## 2. SONIC BRAND (`studio/music.js`, `studio/sfx.js`)

The channel currently has a look. It has no *sound*. Fix, in order:

1. **Sonic logo at 0.00–0.35s.** A single synthesized signature (three
   partials, sub thump, air) that plays under the frameZero burn on every
   video. Recognition in the feed before the eye focuses. Seeded, offline,
   ours — no IP exposure.
2. **The payoff chord.** A second, longer signature reserved for `payoffBeat`.
   Viewers learn that sound = the answer; it becomes the thing they wait for.
3. **Silence as an instrument.** 0.25–0.4s of true silence (music ducked to
   −∞, room tone only) immediately before the payoff. Silence after 20s of bed
   is the loudest sound in the video.
4. **Loudness law.** Integrated −14 LUFS, true peak −1 dBTP, measured in the
   export (WebCodecs path). Quiet videos lose to the next card in the feed.
5. **Music locked to the cut grid.** The bed's BPM is chosen so a bar boundary
   falls within 80ms of `turn` and `payoffBeat`; CUT_PLAN's `edl.js` snaps
   `MICRO` push-ins to the beat grid when a bed is present.
6. **Word-hit SFX.** Every `READOUT` and `INSERT` already gets a sound in
   CUT_PLAN. Add *voice-side* design: a subtle 60Hz rumble under any number
   over one million; a high shimmer under any line containing "light".

---

## 3. CAPTION PHYSICS (`studio/captions.js`, upgrades karaoke burn)

Captions exist. They are not yet a retention instrument.

- **One to three words per card**, never a sentence. The eye reads the card
  faster than the ear hears it — that gap is the engagement.
- **Emphasis word per card**, scaled 1.3×, color = accent, chosen by rule:
  numbers first, then nouns in the `promise.question`, then verbs.
- **Position follows the subject.** With the LIVING_STILLS matte, the card
  sits in the largest empty region and never covers a face or the readout.
- **Kinetic entrance = the beat's emote.** Curiosity beats slide up; shock
  beats punch in; whisper beats fade.
- **Safe zones per platform** (§6) — Shorts progress bar, TikTok right rail,
  Reels bottom 20%. The same take renders three caption placements.
- **Zero orphan frames.** A card is never visible after its word ends by more
  than 120ms. Stale captions read as "lagging" and are punished in rewatch.

---

## 4. THE VARIANT FACTORY (`studio/variants.js`, `pages/Factory.jsx`)

One performance is currently one video. It should be **one master, many
children**, without violating the one-variable law:

| Axis | Variants from a single take | Where they go |
|---|---|---|
| Door | 2 door moves for the same `promise.kind` | main channel: only ONE, per RECOVERY_PLAN; the other → secondary platform |
| Caption style | emphasis-color A/B | secondary platforms only |
| Length | 22s master, 15s "hook+payoff only" cut, 45s "extended turn" | 15s → TikTok/Reels, 45s → Shorts (2026 sweet-spot data) |
| Audio | bed on / bed off (voice + SFX only) | test on secondary |
| First frame | 3 candidates extracted by tracker at peak expression | thumbnail/first-frame test |

Mechanics: the recorder captures the raw take + actor pose track + word index
once. Children are **re-rendered offline** from the same data — no re-perform.
The 15s cut is the promise beats + payoff beat with a hard `CUT` between them;
the compiler verifies the loop seam still closes.

**Hard rule:** the main channel gets exactly one child per 72h seal. The
factory's job is to make the *other* platforms into the laboratory, so the
main channel never has to guess.

---

## 5. TITLE / FIRST-FRAME / THUMBNAIL SYSTEM (`studio/meta.js`)

- **Title ≠ hook** (already a gate). Now generate the title from the
  `promise.question` with the *answer's category* revealed but not the answer:
  "The Sun is not the colour you think" (not "The Sun is white").
- **First frame = door frame 0** (Shorts shows it). Verified by the gate:
  the burn is readable at 120px wide (feed thumbnail scale) — text height ≥ 9%
  of frame.
- **Thumbnail candidates** pulled from the take by the tracker at the top
  three expression peaks; operator picks one. Never a generated image; never a
  frame that isn't in the video (mismatch is punished in 2026 ranking).
- **Description = payoff sentence + one source line.** Nothing else. Sources
  are the moat for a faceless science channel's YPP standing.
- **Trademark sweep** stays (RECOVERY_PLAN §8.0).

---

## 6. PLATFORM RENDER PROFILES (`studio/platforms.js`)

Same master, three exports, each with its own safe zone, caption position,
loudness target, first-frame rule and duration preference. The gate checks the
right profile per target. Publishing order is fixed: secondary platforms at
T+0, main channel at T+24h *only if* the secondaries didn't flag a fault
(caption collision, seam miss) — a free 24h QA pass from real viewers.

---

## 7. COMMENT ENGINE (`studio/comment.js`) — argument without bait

Never "comment YES". Instead, every script carries one **defensible
correction line**: a true, precisely-worded claim that contradicts a common
belief and *sounds* wrong ("the Sun is white", "you have never seen the
Moon's far side", "Pluto hasn't finished one orbit since discovery"). People
comment to correct it; other people correct them; the thread is the reach.

- Data: `dispute: { beat: 7, claim: '...', source: 'NASA/...' }`.
- Gate: claim must have a source line in the description. No dispute → no arm.
- Ledger: comment rate per dispute type feeds §9.

Second lever, honest: **the unanswered adjacent question.** The payoff answers
the promise and the last line *names* — never asks — the next question ("and
that is the small problem. The large one is why it's still there."). That
line is the next episode's `frameZero`. Series memory, not bait.

---

## 8. SERIES MEMORY (`studio/canon.js`, extends the Omega Canon Engine)

Repeat viewers are the compounding asset.

- **Callback glyphs.** `hiddenFrame` glyphs form a sequence across episodes
  (a constellation drawn one star per video). Unsolicited; the people who
  find it become the channel's evangelists.
- **Recurring readout.** One number (e.g. light-seconds to the subject)
  appears in every video in the same place at the same beat. Ritual = brand.
- **Episode threading.** `next.frameZero` from §7 is auto-filled into the next
  script draft; the canon engine refuses two consecutive episodes of the same
  `promise.kind`.
- **The monthly rewatch.** Every 12 episodes the factory cuts a 45s "what we
  learned" child from the 12 payoff beats only — pure payoff, zero cost.

---

## 9. PRE-FLIGHT RETENTION FORECAST (`studio/forecast.js`, in Cut Room)

No ML. A per-second strip under the animatic, four rows, each a rule:

| Row | Signal | Threshold |
|---|---|---|
| EYE | ms since last cut / punch / still move | red > 2.4s |
| EAR | ms since last SFX / bed change / silence | red > 4s |
| MIND | ms since last new noun or number in the word track | red > 5s |
| PROMISE | is an open loop currently unresolved? | red if none open |

A red in any row for > 2 consecutive seconds is a **predicted drop**. The
operator sees where the video will lose people *before* recording it; the
compiler offers the cheapest fix (a `MICRO`, an SFX, a readout of a number
already in the sentence). After 72h, the real retention curve is overlaid on
the forecast — where the forecast was wrong, the rule that fired gets its
threshold adjusted (extends CUT_PLAN §6 ledger; same one-ledger law).

---

## 10. RELEVANCE INTAKE (`studio/trend.js`) — the "why today" layer

Faceless science shorts get their biggest outliers from *timing*: an eclipse,
a launch, a comet, an anniversary, a viral misconception. Add an intake:

- Sources: NASA APOD, eclipse/launch calendars, on-this-day astronomy (all
  reference-only, public domain or CC).
- Each event → suggested `promise.kind` + a stills bundle (LIVING_STILLS
  intake) + a due date. A script written against an event carries
  `deadline:` and jumps the queue.
- **Answer-the-thread episodes.** Paste a top comment from the last upload;
  the script draft opens with it burned as `frameZero` ("someone said the Sun
  is yellow"). The audience becomes the writer's room.

---

## 11. WHEN (sequencing against the other plans)

Nothing here touches the Phase C upload. Order after the seal reads:

| Step | Ships | Gate |
|---|---|---|
| V1 | Promise contracts on all scripts + gate rules + pacing meter | 46/46 scripts pass; payoff ≥ 80% everywhere |
| V2 | Sonic logo, payoff chord, silence-before-payoff, LUFS in export | Export measures −14 ±1 LUFS; logo audible at phone volume |
| V3 | Caption physics + platform profiles | 3 renders from 1 take; no caption in any safe zone |
| V4 | Forecast strip in Cut Room | Forecast marks the 0:14 cliff on the *old* upload's script |
| V5 | Variant factory + comment/dispute data + canon threading | 1 take → 15/22/45s children with verified seams |
| V6 | Relevance intake | Next eclipse produces a queued, deadline-tagged script |

Each step is one variable when it reaches the main channel. The secondary
platforms absorb the rest of the experimentation.

---

## 12. HARD CONSTRAINTS (inherited + Phase V)

- No solicited engagement, ever. Disputes are true and sourced.
- No generated thumbnails; the first frame is in the video.
- Sonic brand is synthesized in-house; no licensed audio near the loop.
- One main-channel variable per seal. The factory feeds other platforms.
- Sources in every description. This is the YPP moat for a faceless channel.
- Forecast is rules + one ledger, not a model. Every threshold is a number in
  a file with a date next to it.

/* THE TAKE DIRECTOR — RETENTION_FIX_PLAN Phase 5.

   The retention layer. Forensics on the published freestyle take found 19
   seconds with ZERO visual change: frame 1 was a static stare, no hook, no
   expression, no punch, no world event. This module makes that structurally
   impossible:

     1. COLD-OPEN HOOK  — an automatic entrance beat inside the first 1.5s:
        expression pop + camera punch settling out to the resting medium shot
        + a world energy pulse. Fired at ~0.25s, NOT frame zero — frame zero
        must stay crisp and calm (a hot expression at 0.0s pushes the lens
        glow over 1.15 and reads as a blurry opening second in the encode).
     2. VISUAL-CHANGE SCHEDULER — guarantees at least one visible change every
        2.5–3s, rotating through punch-in/out (respecting the Phase 3 framing
        clamp), expression cycles, glitch bursts, world energy pulses and
        light shifts. Doubles as the plan's silence guard: the schedule keeps
        firing whether or not anyone is speaking, so no 3s window is static.
     3. SPEECH-AWARE TRIGGERS — a sustained RMS spike (emphasis) pulls the
        next change forward, so the picture reacts to the performance.
     4. FREESTYLE HOOK TEXT — freestyle takes get the same burned-in hook-text
        treatment scripted takes get: the first phrase live recognition hears
        is burned in the frame-zero hook style, then cleared.

   Scripted beats keep authority: every beat FX reports in via noteChange(),
   which resets the scheduler clock, and the expression action is disabled on
   scripted takes so the director never fights the beat sheet. Door takes tick
   only after the reveal (the door owns the picture until then). */

/* deterministic per-take jitter so gaps don't land on a metronome */
function jitter(n, seed) {
  const x = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const GAP_MIN = 2.5;   // the plan's guarantee: a visible change every 2.5–3s
const GAP_SPAN = 0.5;
const EMPHASIS_MIN_GAP = 1.5;   // emphasis may pull a change forward, never spam
const COLD_OPEN_AT = 0.25;      // entrance beat: inside the first 1.5s, off frame zero
const EXPR_POP_HOLD = 1.0;      // seconds the entrance expression holds
const HOOK_WINDOW = 6.0;        // freestyle hook text may land this late, no later
const HOOK_HOLD = 2.4;          // seconds the freestyle hook burn stays up
const HOOK_MAX_WORDS = 6;

/* the rotation the scheduler draws from — ordered so consecutive picks differ
   in kind (camera / face / post / world / light) */
const ACTIONS = ['punchIn', 'expression', 'world', 'glitch', 'punchOut', 'light'];
const EXPR_CYCLE = ['smirk', 'narrow', 'calm', 'shock', 'calm', 'fury', 'calm'];

export function createTakeDirector() {
  let active = false;
  let freestyle = false;
  let scripted = false;
  let captions = true;
  let seed = 1;

  let lastChangeT = 0;     // take-seconds of the last visible change
  let nextGap = GAP_MIN;
  let actionIdx = 0;
  let exprIdx = 0;
  let changeCount = 0;     // Phase 6 report-card telemetry

  let coldOpenFired = false;
  let exprRevertAt = -1;
  let restExpr = 'calm';

  let hookFired = false;
  let hookClearAt = -1;

  let levelAvg = 0.12;     // rolling speech-level EMA for emphasis detection

  function rollGap(n) { return GAP_MIN + GAP_SPAN * jitter(n, seed); }

  function fire(stage, rig, elapsed) {
    /* pick the next action; camera moves respect the Phase 3 framing clamp —
       never punch IN when the face is already near the 55–60% ceiling */
    let act = ACTIONS[actionIdx % ACTIONS.length];
    actionIdx++;
    if (act === 'expression' && scripted) { act = ACTIONS[actionIdx % ACTIONS.length]; actionIdx++; }
    if (act === 'punchIn') {
      const fr = stage.framing;
      if (fr && (fr.clamped || fr.headFrac > 0.5)) act = 'punchOut';
    }
    switch (act) {
      case 'punchIn': stage.punch(3.2); break;
      case 'punchOut': stage.punch(-2.8); break;
      case 'expression':
        rig.expression = EXPR_CYCLE[exprIdx % EXPR_CYCLE.length];
        exprIdx++;
        break;
      case 'glitch': stage.glitch(0.22); break;
      case 'world': if (stage.energyPulse) stage.energyPulse(1.1); break;
      case 'light': if (stage.lightShift) stage.lightShift(0.9); break;
      default: break;
    }
    lastChangeT = elapsed;
    nextGap = rollGap(changeCount + 1);
    changeCount++;
  }

  return {
    /** arm the director for a take. Call AFTER the recorder rolls. */
    start(stage, rig, opts = {}) {
      active = true;
      freestyle = !!opts.freestyle;
      scripted = !!opts.scripted;
      captions = opts.captions !== false;
      seed = (performance.now() % 1000) / 1000 + 0.5;
      lastChangeT = 0;
      nextGap = rollGap(0);
      actionIdx = 0;
      exprIdx = 0;
      changeCount = 0;
      coldOpenFired = !!opts.skipColdOpen; // door takes: the reveal IS the entrance
      exprRevertAt = -1;
      restExpr = rig ? rig.expression : 'calm';
      hookFired = false;
      hookClearAt = -1;
      levelAvg = 0.12;
    },

    /** a beat FX / the door reveal just changed the picture — reset the clock
        so the scheduler fills gaps instead of stacking on top of the script */
    noteChange(elapsed) {
      if (!active) return;
      lastChangeT = elapsed;
      nextGap = rollGap(changeCount + 1);
      changeCount++;
    },

    /** per-frame drive. elapsed = recorder seconds; level = smoothed speech RMS. */
    tick(stage, rig, voice, elapsed, dt) {
      if (!active || !stage || !rig || !(elapsed >= 0)) return;

      /* 1. COLD-OPEN HOOK — the entrance beat, once, just off frame zero */
      if (!coldOpenFired && elapsed >= COLD_OPEN_AT) {
        coldOpenFired = true;
        stage.punch(3.0);                       // settles out to the resting medium shot
        if (stage.energyPulse) stage.energyPulse(1.3);
        restExpr = rig.expression || 'calm';
        rig.expression = 'smirk';               // mild pop — never a hot lens at the open
        rig.exprSnap = true;
        exprRevertAt = elapsed + EXPR_POP_HOLD;
        lastChangeT = elapsed;
        nextGap = rollGap(0);
        changeCount++;
      }
      if (exprRevertAt > 0 && elapsed >= exprRevertAt) {
        exprRevertAt = -1;
        rig.expression = restExpr;
      }

      /* 4. FREESTYLE HOOK TEXT — burn the first recognized phrase, hook-style */
      if (freestyle && captions && !hookFired && elapsed <= HOOK_WINDOW && voice && voice.firstPhrase) {
        const phrase = voice.firstPhrase();
        if (phrase) {
          hookFired = true;
          const words = phrase.trim().split(/\s+/).slice(0, HOOK_MAX_WORDS).join(' ');
          if (words && stage.burn) {
            stage.burn(words);
            hookClearAt = elapsed + HOOK_HOLD;
          }
        }
      }
      if (hookClearAt > 0 && elapsed >= hookClearAt) {
        hookClearAt = -1;
        stage.clearBurn();
      }

      /* 3. SPEECH-REACTIVE EMPHASIS — a spike well above the rolling average
         pulls the next change forward */
      const level = Math.max(0, Math.min(1, rig.level || 0));
      levelAvg += (level - levelAvg) * Math.min(1, dt * 0.8);
      const emphasis = level > 0.25 && level > levelAvg * 1.8;

      /* 2. THE SCHEDULER — the guarantee (and the silence guard: it fires on
         schedule whether or not anyone is speaking) */
      const since = elapsed - lastChangeT;
      if (since >= nextGap || (emphasis && since >= EMPHASIS_MIN_GAP)) {
        fire(stage, rig, elapsed);
      }
    },

    /** take over — every stop/restart/unmount path calls this */
    stop(stage) {
      if (!active) return;
      active = false;
      if (hookClearAt > 0 && stage && stage.clearBurn) stage.clearBurn();
      hookClearAt = -1;
      exprRevertAt = -1;
    },

    /** Phase 6 report-card surface */
    get report() {
      return { changes: changeCount, hooked: coldOpenFired, hookText: hookFired };
    },
  };
}

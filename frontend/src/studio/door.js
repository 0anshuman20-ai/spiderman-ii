/* THE DOOR — RECOVERY_PLAN v3 §2 / Phase A2.

   Seconds 0→doorSec of every scripted take, as an enforced choreography
   instead of data nobody reads. Six opening grammars ("door moves"), distilled
   from the 46 scripts' own frameZeroShot directions — the anti-template
   vocabulary that keeps consecutive uploads' first frames distinct (the exact
   YPP repetition risk the plan names) while still hiding/withholding the
   character until the reveal lands on the line-2 trigger.

   v3 correction 1 — VO-OVER-MYSTERY: the door NEVER silences the voice. Line 1
   plays as disembodied voice-over the anomaly from the first jaw trigger; the
   engine only owns the PICTURE (camera pose, actor visibility, glitch pulses,
   exposure). The reveal (resolve()) + score entry + punch land together at
   doorSec — the measured rewind magnet, now arriving with the groove.

   Interface (driven from pages/Studio.jsx on the RECORDER's clock):
     arm(script, stage, rig) → doorSec   pose frame zero (may hide the actor)
     update(el)                          per-frame drive, el = seconds into take
     resolve()                           the reveal: neutral pose, actor shown
     seam(u)                             loop seam: lerp BACK to the opening
                                         composition over the final ~0.8s so
                                         frame-last ≈ frame-zero (v3 corr. 2)
     abort()                             any exit: neutral, actor visible

   Every driver is a small pure pose over existing instruments — the stage's
   doorCam offsets (applied after the handheld solve, so the humanization
   survives), setActorVisible, glitch, and tone-mapping exposure. */

export const DEFAULT_DOOR_SEC = 1.5;

export const DOOR_MOVES = ['COLD_WORLD', 'MASK_SNAP', 'WHIP_PAN', 'GLITCH_CUT', 'PROP_REVEAL', 'DIM_WORLD'];

const NEUTRAL = { dolly: 0, yaw: 0, pitch: 0, fov: 0, exposure: 1 };

const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3); // cubic out
const lerp = (a, b, u) => a + (b - a) * u;

/* pose(move, t, d) → camera/exposure offsets t seconds into a d-second door.
   Every move ends NEAR its own opening frame (slow drift only), because the
   loop seam replays pose(move, 0, d) at the tail — pure functions make the
   seam trivially exact. */
function pose(move, t, d) {
  const u = Math.min(1, Math.max(0, t / d));
  switch (move) {
    case 'COLD_WORLD':
      /* character hidden, anomaly-only, slow push toward the world */
      return { dolly: 0.06 + ease(u) * 0.22, yaw: 0, pitch: 0.02, fov: 1.5, exposure: 1 };
    case 'MASK_SNAP': {
      /* extreme close framing; eyes-up snap at ~0.4s — camera pitched down at
         the mask, snapping level in ~0.12s */
      const snap = ease((t - 0.4) / 0.12);
      return { dolly: 1.05, yaw: 0, pitch: lerp(0.11, 0, snap), fov: -7, exposure: 1 };
    }
    case 'WHIP_PAN': {
      /* 0.3s camera whip landing on the subject; the glitch on landing is
         fired from update() so it happens once, not per-frame */
      const whip = 1 - ease(t / 0.3);
      return { dolly: 0.55, yaw: -0.85 * whip, pitch: 0, fov: -3, exposure: 1 };
    }
    case 'GLITCH_CUT':
      /* broken transmission: framing is steady mid-motion; the 2-frame hard
         glitches are pulsed from update() */
      return { dolly: 0.6, yaw: 0, pitch: 0, fov: -3, exposure: 1 };
    case 'PROP_REVEAL': {
      /* tight on a detail (readout/hand, low in frame), pulling back and up
         to the subject across the door */
      const pull = ease(u);
      return { dolly: lerp(1.25, 0.35, pull), yaw: 0, pitch: lerp(-0.22, 0, pull), fov: lerp(-8, -2, pull), exposure: 1 };
    }
    case 'DIM_WORLD': {
      /* the world param animated through the door: light climbing out of a
         near-dead exposure as the anomaly "arrives" */
      const rise = ease(u);
      return { dolly: 0.3, yaw: 0, pitch: 0, fov: 0, exposure: lerp(0.28, 1, rise) };
    }
    default:
      return { ...NEUTRAL };
  }
}

export function createDoor() {
  let stage = null;
  let move = null;
  let doorSec = DEFAULT_DOOR_SEC;
  let whipLanded = false;    // WHIP_PAN's landing glitch fires exactly once
  let lastGlitchAt = -1;     // GLITCH_CUT's pulse train, keyed on take time
  let armed = false;

  function apply(p) {
    if (!stage || !stage.doorCam) return;
    const c = stage.doorCam;
    c.dolly = p.dolly; c.yaw = p.yaw; c.pitch = p.pitch; c.fov = p.fov; c.exposure = p.exposure;
    c.active = true;
  }

  function neutral() {
    if (!stage || !stage.doorCam) return;
    const c = stage.doorCam;
    c.dolly = 0; c.yaw = 0; c.pitch = 0; c.fov = 0; c.exposure = 1;
    c.active = false;
  }

  return {
    get armed() { return armed; },
    get move() { return move; },
    get doorSec() { return doorSec; },

    /** pose frame zero. Returns the door length in seconds (per-script tunable
        via `doorSec` in the data; plan default 1.5). */
    arm(script, stageIn) {
      stage = stageIn;
      move = (script && DOOR_MOVES.includes(script.doorMove)) ? script.doorMove : 'MASK_SNAP';
      doorSec = (script && Number(script.doorSec) > 0) ? Number(script.doorSec) : DEFAULT_DOOR_SEC;
      whipLanded = false;
      lastGlitchAt = -1;
      armed = true;
      /* COLD_WORLD withholds the character entirely; every other move keeps
         the subject in frame but owns HOW it is framed */
      if (stage.setActorVisible) stage.setActorVisible(move !== 'COLD_WORLD');
      apply(pose(move, 0, doorSec));
      /* GLITCH_CUT opens ON a hard glitch — broken transmission from frame zero */
      if (move === 'GLITCH_CUT' && stage.glitch) stage.glitch(0.12);
      return doorSec;
    },

    /** per-frame drive while the door is closed. el = seconds into the take
        on the RECORDER's clock (drift-proof). */
    update(el) {
      if (!armed) return;
      apply(pose(move, el, doorSec));
      if (move === 'WHIP_PAN' && !whipLanded && el >= 0.3) {
        whipLanded = true;
        if (stage.glitch) stage.glitch(0.18); // the whip lands with a glitch
      }
      if (move === 'GLITCH_CUT') {
        /* 2-frame hard glitches every ~0.5s, resuming mid-motion between */
        const slot = Math.floor(el / 0.5);
        if (slot !== lastGlitchAt && el > 0.05) {
          lastGlitchAt = slot;
          if (stage.glitch) stage.glitch(0.07);
        }
      }
    },

    /** THE REVEAL — doorSec on the recorder's clock. The caller fires the
        punch/glitch/impact/score; the door only restores the picture. */
    resolve() {
      if (!armed) return;
      armed = false;
      if (stage && stage.setActorVisible) stage.setActorVisible(true);
      neutral();
    },

    /** LOOP SEAM (v3 correction 2 — replaces the end card): u 0→1 across the
        final ~0.8s lerps the camera/world back to the door's OPENING
        composition, so the last frame ≈ the first frame and the restart is
        invisible. COLD_WORLD re-hides the actor at the very end — its frame
        zero has no character in it. */
    seam(u) {
      if (!stage || !move) return;
      const open = pose(move, 0, doorSec);
      const e = ease(u);
      apply({
        dolly: open.dolly * e,
        yaw: open.yaw * e,
        pitch: open.pitch * e,
        fov: open.fov * e,
        exposure: lerp(1, open.exposure, e),
      });
      if (move === 'COLD_WORLD' && stage.setActorVisible) stage.setActorVisible(u < 0.85);
    },

    /** any exit (stop, restart, recorder-offline, unmount): the preview can
        structurally never strand door-closed */
    abort() {
      armed = false;
      if (stage && stage.setActorVisible) stage.setActorVisible(true);
      neutral();
    },
  };
}

/** parse the hiddenFrame data line ("at 9.2s, 3 frames: <what>") into an
    insert spec for the overlay renderer. Times are SCRIPT time — the caller
    shifts by doorSec. Returns null when the line doesn't parse (glyph-only
    insert still fires if a time is found). */
export function parseHiddenFrame(hiddenFrame) {
  if (!hiddenFrame) return null;
  const at = /at\s+([\d.]+)\s*s/i.exec(hiddenFrame);
  if (!at) return null;
  const text = /frames?:\s*(.+)$/i.exec(hiddenFrame);
  return {
    atSec: parseFloat(at[1]),
    text: text ? text[1].trim() : '',
  };
}

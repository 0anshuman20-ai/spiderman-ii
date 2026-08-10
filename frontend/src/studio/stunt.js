/* THE STUNT ENGINE — Ω.4

   Motion no body in a room can make.

   A performed rig hands control to physics and takes it back. The web-line is a
   real constraint, not a camera trick: a verlet pendulum with gravity, rope
   tension and air drag, integrated at a fixed 1/240s step and BAKED at construction
   time. Baking is what makes a stunt usable in a cut — the arc is identical on
   every re-render, it can be scrubbed frame-accurately, and it costs nothing at
   render time because it already happened.

   Outside its window the shot is the performance, untouched. At the window edges
   the two cross-fade, so the handoff from performed pose to simulation is invisible.

   Zero dependencies: verlet integration in ~40 lines beats adding a physics engine
   to the bundle for one constraint. */
import { J, JOINT, REST, fk, restAngles } from './perf';

const STEP = 1 / 240;
const G = -9.81;

/* ------------------------------------------------------------------ */
/* bake the arc: a mass on a rope, released with a push, swinging and letting go  */

function bake({ t0, t1, anchor, start, push, ropeSlack, release }) {
  const dur = Math.max(0.1, t1 - t0);
  const steps = Math.ceil(dur / STEP) + 2;
  const px = new Float32Array(steps), py = new Float32Array(steps), pz = new Float32Array(steps);
  const vx = new Float32Array(steps), vy = new Float32Array(steps), vz = new Float32Array(steps);

  let x = start[0], y = start[1], z = start[2];
  let ox = x - push[0] * STEP, oy = y - push[1] * STEP, oz = z - push[2] * STEP;
  const L = Math.hypot(x - anchor[0], y - anchor[1], z - anchor[2]) * ropeSlack;
  const releaseStep = Math.floor((release * dur) / STEP);

  for (let s = 0; s < steps; s++) {
    px[s] = x; py[s] = y; pz[s] = z;
    vx[s] = (x - ox) / STEP; vy[s] = (y - oy) / STEP; vz[s] = (z - oz) / STEP;

    // verlet integrate with light air drag
    const nx = x + (x - ox) * 0.998;
    const ny = y + (y - oy) * 0.998 + G * STEP * STEP;
    const nz = z + (z - oz) * 0.998;
    ox = x; oy = y; oz = z;
    x = nx; y = ny; z = nz;

    // rope constraint: inextensible while attached, gone after release
    if (s < releaseStep) {
      const dx = x - anchor[0], dy = y - anchor[1], dz = z - anchor[2];
      const d = Math.hypot(dx, dy, dz) || 1e-6;
      const corr = (d - L) / d;
      x -= dx * corr; y -= dy * corr; z -= dz * corr;
    }
    // floor: a stunt that ends below the ground is a bug, not a landing
    if (y < 0.55) { y = 0.55; oy = y + (oy - y) * 0.4; }
  }
  return { px, py, pz, vx, vy, vz, steps, dur, anchor, releaseStep, L };
}

/* ------------------------------------------------------------------ */
/* pose the body for the arc: both arms up the rope, legs trailing the velocity   */

function swingPose(out, arc, s, attached) {
  const a = restAngles();
  const speed = Math.hypot(arc.vx[s], arc.vy[s], arc.vz[s]);
  const trail = Math.max(-1.2, Math.min(1.2, arc.vz[s] * 0.16));
  if (attached) {
    // both arms reach up the line; the lead arm is straighter
    a.lSwing = 2.55; a.rSwing = 2.72;
    a.lAbduct = 0.30; a.rAbduct = 0.22;
    a.lElbow = 0.30; a.rElbow = 0.12;
    a.lHip = 0.55 - trail * 0.5; a.rHip = 0.42 - trail * 0.5;
    a.lKnee = 0.85 + trail * 0.3; a.rKnee = 0.45 + trail * 0.2;
    a.spineBend = 0.22; a.lean = 0.3;
  } else {
    // free-fall: arms wide, body opens, legs tuck for the landing
    const k = Math.min(1, speed * 0.06);
    a.lSwing = 1.45 + k * 0.5; a.rSwing = 1.15 + k * 0.5;
    a.lAbduct = 0.9; a.rAbduct = 0.95;
    a.lElbow = 0.5; a.rElbow = 0.45;
    a.lHip = 0.9; a.rHip = 0.55; a.lKnee = 1.1; a.rKnee = 0.7;
    a.spineBend = -0.2;
  }
  a.headPitch = attached ? -0.25 : 0.15;
  fk(a, out);

  /* rotate the whole body into the rope direction (attached) or the velocity
     vector (airborne) so it never reads as a standing pose sliding through space */
  let ang;
  if (attached) ang = Math.atan2(arc.px[s] - arc.anchor[0], arc.anchor[1] - arc.py[s]);
  else ang = Math.atan2(arc.vx[s], Math.max(0.2, -arc.vy[s]));
  const c = Math.cos(-ang), sn = Math.sin(-ang);
  for (let i = 0; i < J; i++) {
    const x = out[i * 3], y = out[i * 3 + 1];
    out[i * 3] = x * c - y * sn;
    out[i * 3 + 1] = x * sn + y * c;
  }
  return ang;
}

/* ------------------------------------------------------------------ */

export const STUNT_PRESETS = [
  {
    key: 'web-swing', name: 'WEB SWING', detail: 'anchor high camera-left, full arc, release into flight',
    make: (t0, t1) => ({ t0, t1, anchor: [-3.2, 8.4, -1.4], start: [2.6, 2.3, 1.2], push: [-3.4, 0.6, -0.4], ropeSlack: 1.0, release: 0.72 }),
  },
  {
    key: 'pendulum-pass', name: 'PENDULUM PASS', detail: 'swings through frame and holds the line',
    make: (t0, t1) => ({ t0, t1, anchor: [0.4, 9.2, -2.0], start: [3.4, 3.0, 2.0], push: [-4.6, 0.2, -1.2], ropeSlack: 1.0, release: 1.0 }),
  },
  {
    key: 'freefall-catch', name: 'FREEFALL CATCH', detail: 'drops, catches late, snaps taut',
    make: (t0, t1) => ({ t0, t1, anchor: [-1.0, 10.0, -0.6], start: [1.2, 6.4, 0.8], push: [0.4, -1.2, 0.2], ropeSlack: 0.86, release: 1.0 }),
  },
];

/**
 * A takeover window. `solve(t, jointBuf, conf)` overwrites the performed pose with
 * the baked simulation inside [t0, t1], cross-faded at the edges, and reports the
 * airborne root so the Synthetic Actor stops foot-locking to the floor.
 */
export function createStunt(spec, { fade = 0.2 } = {}) {
  const arc = bake(spec);
  const simBuf = new Float32Array(J * 3);
  const solver = {
    spec, arc,
    root: null,              // {x,y,z} while the stunt owns the body, else null
    active: false,

    solve(t, jointBuf, conf) {
      const local = t - spec.t0;
      if (local < -fade || local > arc.dur + fade) { solver.active = false; solver.root = null; return conf; }
      const s = Math.max(0, Math.min(arc.steps - 1, Math.round(local / STEP)));
      const attached = s < arc.releaseStep;
      swingPose(simBuf, arc, s, attached);

      // edge cross-fade: performed pose -> simulation -> performed pose
      const w = Math.max(0, Math.min(1, Math.min((local + fade) / (fade * 2), (arc.dur + fade - local) / (fade * 2))));
      for (let i = 0; i < J * 3; i++) jointBuf[i] = jointBuf[i] * (1 - w) + simBuf[i] * w;

      // hips ride the arc; the foot lock must yield, so hand the root up explicitly
      const hipY = arc.py[s];
      const groundHips = REST.thigh + REST.shin;
      solver.active = w > 0.02;
      solver.root = {
        x: arc.px[s] * w,
        y: groundHips + (hipY - groundHips) * w,
        z: arc.pz[s] * w,
      };
      // physics is fully trusted inside the window: never blend in a fallback pose
      return conf * (1 - w) + 1 * w;
    },
  };
  return solver;
}

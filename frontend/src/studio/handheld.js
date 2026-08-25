/* CAMERA HUMANIZATION — RECOVERY_PLAN 1.2 #2

   "A mathematically still or mathematically smooth camera screams synthetic."

   Phones read realism from camera artifacts. This module supplies the three the
   plan names, all as PURE FUNCTIONS of (time, seed) so they honor the studio's
   determinism contract — same shot + same seed = the same frames, forever:

     · handheld drift    — smooth value-noise on position AND rotation, ~0.3Hz
                           dominant band with a finer tremor octave on top
     · push-in           — nothing is ever static; a slow multiplier every rig
                           can apply on top of its own move
     · focus breathing   — a sub-degree FOV oscillation, the tell of a real lens

   Amplitudes are deliberately tiny. The audience must never SEE the shake —
   they must only stop being able to prove the camera is synthetic. */

/* deterministic 1D value noise: smooth, band-limited, allocation-free */
function vnoise(t, seed) {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f); // smoothstep fade
  const h = (n) => {
    const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return h(i) * (1 - u) + h(i + 1) * u;
}

/* two octaves centered on the plan's ~0.3Hz handheld band, zero-mean */
function drift(t, seed) {
  return (vnoise(t * 0.3, seed) - 0.5) * 1.35 + (vnoise(t * 1.7, seed + 40) - 0.5) * 0.22;
}

export const HANDHELD_DEFAULT = {
  pos: 0.011,     // metres of positional wander
  rot: 0.0035,    // radians of rotational wander (~0.2 deg)
  breath: 0.32,   // degrees of FOV breathing
  push: 0.045,    // fraction of dolly push-in across the shot
};

/**
 * Create a deterministic handheld rig.
 * `apply(camera, t, u)` perturbs an already-posed camera in place:
 *   t = shot time (seconds), u = shot progress 0..1 (drives the push-in).
 * Call AFTER the rig/base solve and BEFORE render. Never touches lookAt targets,
 * so framing intent survives — only the machine-perfection dies.
 */
export function createHandheld(seed = 7, opts = {}) {
  const o = { ...HANDHELD_DEFAULT, ...opts };
  const s = seed || 7;
  return {
    seed: s,
    apply(camera, t, u = 0) {
      // positional wander (each axis on its own noise lane)
      camera.position.x += drift(t, s + 1) * o.pos;
      camera.position.y += drift(t, s + 2) * o.pos * 0.7;
      camera.position.z += drift(t, s + 3) * o.pos * 0.5;
      // push-in: the camera is ALWAYS creeping toward the subject
      camera.translateZ(-u * o.push);
      // rotational wander — the strongest humanizer per amplitude
      camera.rotation.x += drift(t, s + 4) * o.rot;
      camera.rotation.y += drift(t, s + 5) * o.rot;
      camera.rotation.z += drift(t, s + 6) * o.rot * 0.4;
      // focus breathing — micro FOV oscillation, like a lens element settling
      camera.fov += drift(t * 0.6, s + 7) * o.breath;
      camera.updateProjectionMatrix();
    },
  };
}

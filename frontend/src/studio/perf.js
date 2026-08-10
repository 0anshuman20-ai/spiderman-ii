/* THE PERFORMANCE FILE (`.veyl`)

   INVERSION 1, made concrete: a take is not pixels, it is a rig timeline.
   While you record video, this samples the performance itself at a fixed 30Hz —
   metric 3D joints, face signals, voice envelope, expression and FX beats — into
   flat Float32Arrays. ~13KB/second. That timeline is what the Omega Layer replays,
   re-frames, re-lights and re-cuts, long after the webcam is closed.

   Every axis convention is fixed HERE so nothing downstream has to guess:
     x = viewer right, y = UP, z = toward the viewer, metres, hips at the origin.
   (MediaPipe world landmarks are y-down, so capture negates y exactly once.) */

export const FPS = 30;
export const J = 33;               // MediaPipe pose topology, kept as the wire format
export const FACE_CH = 10;         // yaw pitch roll jaw blinkL blinkR smile brow level glitch

export const JOINT = {
  nose: 0, earL: 7, earR: 8,
  shoulderL: 11, shoulderR: 12, elbowL: 13, elbowR: 14, wristL: 15, wristR: 16,
  handL: 19, handR: 20,
  hipL: 23, hipR: 24, kneeL: 25, kneeR: 26, ankleL: 27, ankleR: 28,
  heelL: 29, heelR: 30, toeL: 31, toeR: 32,
};

/* canonical rest skeleton — also the fallback body when tracking confidence dies */
export const REST = {
  hipHalf: 0.095, shoulderHalf: 0.195, spine: 0.53,
  neck: 0.60, head: 0.14,
  upperArm: 0.29, foreArm: 0.255, hand: 0.10,
  thigh: 0.425, shin: 0.415, foot: 0.17,
  groundY: 0.92,                   // hips this far above the floor when standing
};

export const FACE = { yaw: 0, pitch: 1, roll: 2, jaw: 3, blinkL: 4, blinkR: 5, smile: 6, brow: 7, level: 8, glitch: 9 };

/* ------------------------------------------------------------------ */
/* deterministic PRNG — every synthetic performance is reproducible     */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/* ------------------------------------------------------------------ */
/* FORWARD KINEMATICS
   One angle vector -> 33 metric joints. Used to synthesize performances and to
   drive the procedural fallback when a limb drops below retarget confidence. */

export function restAngles() {
  return {
    rootX: 0, rootY: 0, rootZ: 0, rootYaw: 0, lean: 0,
    spineYaw: 0, spineBend: 0, headYaw: 0, headPitch: 0,
    lSwing: 0.06, lAbduct: 0.14, lElbow: 0.22,
    rSwing: 0.06, rAbduct: 0.14, rElbow: 0.22,
    lHip: 0.02, lKnee: 0.06, rHip: -0.02, rKnee: 0.06,
  };
}

function limb(out, i, x, y, z) { out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z; }

/* arm chain: swing rotates forward/back around x, abduct opens away from the ribs */
function armChain(out, side, sx, sy, sz, swing, abduct, elbow) {
  const s = side; // -1 viewer-left, +1 viewer-right
  const dirX = Math.sin(abduct) * s * 0.55 + s * 0.32;
  const dirY = -Math.cos(abduct) * Math.cos(swing);
  const dirZ = Math.sin(swing);
  const n = Math.hypot(dirX, dirY, dirZ) || 1;
  const ex = sx + (dirX / n) * REST.upperArm;
  const ey = sy + (dirY / n) * REST.upperArm;
  const ez = sz + (dirZ / n) * REST.upperArm;
  // forearm bends in the plane of the upper arm, folding toward the chest
  const fx = (dirX / n) * Math.cos(elbow) + s * Math.sin(elbow) * 0.15;
  const fy = (dirY / n) * Math.cos(elbow) + Math.sin(elbow) * 0.42;
  const fz = (dirZ / n) * Math.cos(elbow) + Math.sin(elbow) * 0.86;
  const fn = Math.hypot(fx, fy, fz) || 1;
  const wx = ex + (fx / fn) * REST.foreArm;
  const wy = ey + (fy / fn) * REST.foreArm;
  const wz = ez + (fz / fn) * REST.foreArm;
  const hx = wx + (fx / fn) * REST.hand;
  const hy = wy + (fy / fn) * REST.hand;
  const hz = wz + (fz / fn) * REST.hand;
  const E = s < 0 ? JOINT.elbowL : JOINT.elbowR;
  const W = s < 0 ? JOINT.wristL : JOINT.wristR;
  const Hd = s < 0 ? JOINT.handL : JOINT.handR;
  limb(out, E, ex, ey, ez); limb(out, W, wx, wy, wz); limb(out, Hd, hx, hy, hz);
}

function legChain(out, side, hx, hy, hz, hip, knee) {
  const s = side;
  const kx = hx + Math.sin(hip) * 0.05 * s;
  const ky = hy - Math.cos(hip) * REST.thigh;
  const kz = hz + Math.sin(hip) * REST.thigh;
  const sx2 = kx;
  const sy2 = ky - Math.cos(knee) * REST.shin;
  const sz2 = kz - Math.sin(knee) * REST.shin;
  const K = s < 0 ? JOINT.kneeL : JOINT.kneeR;
  const A = s < 0 ? JOINT.ankleL : JOINT.ankleR;
  const He = s < 0 ? JOINT.heelL : JOINT.heelR;
  const T = s < 0 ? JOINT.toeL : JOINT.toeR;
  limb(out, K, kx, ky, kz); limb(out, A, sx2, sy2, sz2);
  limb(out, He, sx2, sy2 - 0.02, sz2 - 0.05);
  limb(out, T, sx2, sy2 - 0.03, sz2 + REST.foot);
}

/** angles -> one 33x3 metric pose written into `out` (Float32Array, length >= 99) */
export function fk(a, out) {
  const cy = Math.cos(a.rootYaw), sy = Math.sin(a.rootYaw);
  const rot = (x, z) => [x * cy + z * sy, -x * sy + z * cy];

  const [hlx, hlz] = rot(-REST.hipHalf, 0);
  const [hrx, hrz] = rot(REST.hipHalf, 0);
  limb(out, JOINT.hipL, hlx, 0, hlz);
  limb(out, JOINT.hipR, hrx, 0, hrz);

  const spineTop = REST.spine;
  const bendZ = Math.sin(a.spineBend) * 0.14 + Math.sin(a.lean) * 0.10;
  const shoulderYaw = a.rootYaw + a.spineYaw;
  const scy = Math.cos(shoulderYaw), ssy = Math.sin(shoulderYaw);
  const srot = (x, z) => [x * scy + z * ssy, -x * ssy + z * scy];
  const [slx, slz] = srot(-REST.shoulderHalf, bendZ);
  const [srx, srz] = srot(REST.shoulderHalf, bendZ);
  limb(out, JOINT.shoulderL, slx, spineTop, slz);
  limb(out, JOINT.shoulderR, srx, spineTop, srz);

  const headYaw = shoulderYaw + a.headYaw;
  const hcy = Math.cos(headYaw), hsy = Math.sin(headYaw);
  const nx = bendZ * 0.4;
  const noseZ = REST.head * 0.62 * Math.cos(a.headPitch);
  limb(out, JOINT.nose, nx + hsy * noseZ, REST.neck + REST.head * 0.55 - Math.sin(a.headPitch) * 0.06, nx * 0.2 + hcy * noseZ);
  limb(out, JOINT.earL, nx - hcy * REST.head * 0.52, REST.neck + REST.head * 0.5, nx + hsy * REST.head * 0.52);
  limb(out, JOINT.earR, nx + hcy * REST.head * 0.52, REST.neck + REST.head * 0.5, nx - hsy * REST.head * 0.52);

  armChain(out, -1, slx, spineTop, slz, a.lSwing, a.lAbduct, a.lElbow);
  armChain(out, 1, srx, spineTop, srz, a.rSwing, a.rAbduct, a.rElbow);
  legChain(out, -1, hlx, 0, hlz, a.lHip, a.lKnee);
  legChain(out, 1, hrx, 0, hrz, a.rHip, a.rKnee);
  return out;
}

/* ------------------------------------------------------------------ */
/* THE PERFORMANCE FILE                                                */

export function makePerformance({ name, seconds, world = 'nebula-drift', source = 'performed', seed = 1 }) {
  const frames = Math.max(1, Math.round(seconds * FPS));
  return {
    magic: 'VEYL', v: 1,
    id: `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    name, world, source, seed,
    createdAt: new Date().toISOString(),
    fps: FPS, frames, duration: frames / FPS,
    joints: new Float32Array(frames * J * 3),
    vis: new Float32Array(frames * J),
    face: new Float32Array(frames * FACE_CH),
    direction: [],                        // {t, kind, value} — camera/fx/world/beat events
    calib: { height: 1.78, shoulder: REST.shoulderHalf * 2 },
  };
}

/** read one frame of a performance into a reusable 99-float buffer */
export function readFrame(perf, frame, out) {
  const f = Math.max(0, Math.min(perf.frames - 1, frame));
  out.set(perf.joints.subarray(f * J * 3, f * J * 3 + J * 3));
  return out;
}

/** sample at an arbitrary time with linear joint interpolation (Inversion 1's speed ramps) */
export function sampleAt(perf, time, out, faceOut) {
  const x = Math.max(0, Math.min(perf.frames - 1.0001, time * perf.fps));
  const f0 = Math.floor(x), f1 = Math.min(perf.frames - 1, f0 + 1), k = x - f0;
  const a = f0 * J * 3, b = f1 * J * 3;
  for (let i = 0; i < J * 3; i++) out[i] = perf.joints[a + i] * (1 - k) + perf.joints[b + i] * k;
  if (faceOut) {
    const fa = f0 * FACE_CH, fb = f1 * FACE_CH;
    for (let i = 0; i < FACE_CH; i++) faceOut[i] = perf.face[fa + i] * (1 - k) + perf.face[fb + i] * k;
  }
  return out;
}

export function meanVisibility(perf, frame) {
  let s = 0;
  for (let i = 0; i < J; i++) s += perf.vis[frame * J + i];
  return s / J;
}

/* ------------------------------------------------------------------ */
/* LIVE CAPTURE — runs beside the video recorder, costs one array write */

export class PerfRecorder {
  constructor() { this.active = false; this.perf = null; }

  start({ name, world, maxSeconds = 300 }) {
    this.perf = makePerformance({ name, seconds: maxSeconds, world });
    this.perf.frames = 0;                      // grows as frames land
    this.capacity = Math.round(maxSeconds * FPS);
    this.acc = 0;
    this.active = true;
    return this.perf;
  }

  /** call every render frame; writes at most FPS samples per second */
  sample(dt, rig, tracker) {
    if (!this.active) return;
    this.acc += dt;
    const step = 1 / FPS;
    if (this.acc < step) return;
    this.acc -= step;
    const p = this.perf;
    const f = p.frames;
    if (f >= this.capacity) { this.active = false; return; }

    const world = tracker && tracker.points && tracker.points.pose && tracker.points.pose.world;
    const lm = tracker && tracker.points && tracker.points.pose && tracker.points.pose.lm;
    const base = f * J * 3;
    if (world && world.length >= J) {
      for (let i = 0; i < J; i++) {
        p.joints[base + i * 3] = world[i].x;
        p.joints[base + i * 3 + 1] = -world[i].y;     // MediaPipe is y-down; the Vault is y-up
        p.joints[base + i * 3 + 2] = world[i].z;
        p.vis[f * J + i] = lm && lm[i] ? lm[i].v : 1;
      }
    } else {
      // no body solve this frame (sim mode, or you left the frame): write the rest pose
      // at zero confidence so the Synthetic Actor knows to fall back instead of flail
      fk(restAngles(), this.scratch || (this.scratch = new Float32Array(J * 3)));
      p.joints.set(this.scratch, base);
      for (let i = 0; i < J; i++) p.vis[f * J + i] = 0;
    }

    const fb = f * FACE_CH;
    p.face[fb + FACE.yaw] = rig.headYaw; p.face[fb + FACE.pitch] = rig.headPitch; p.face[fb + FACE.roll] = rig.headRoll;
    p.face[fb + FACE.jaw] = rig.jaw; p.face[fb + FACE.blinkL] = rig.blinkL; p.face[fb + FACE.blinkR] = rig.blinkR;
    p.face[fb + FACE.smile] = rig.smile; p.face[fb + FACE.brow] = rig.browUp - rig.browDown;
    p.face[fb + FACE.level] = rig.level; p.face[fb + FACE.glitch] = rig.glitch > 0 ? 1 : 0;

    p.frames = f + 1;
  }

  mark(kind, value) {
    if (!this.active) return;
    this.perf.direction.push({ t: this.perf.frames / FPS, kind, value });
  }

  /** trim the buffers to what was actually performed and hand back the file */
  stop() {
    if (!this.perf) return null;
    this.active = false;
    const p = this.perf;
    p.frames = Math.max(1, p.frames);
    p.joints = p.joints.slice(0, p.frames * J * 3);
    p.vis = p.vis.slice(0, p.frames * J);
    p.face = p.face.slice(0, p.frames * FACE_CH);
    p.duration = p.frames / FPS;
    this.perf = null;
    return p;
  }
}

/* ------------------------------------------------------------------ */
/* SYNTHESIS — beats in, performance out.
   This is what makes the Omega Layer usable on day one and with no camera:
   a deterministic, physically sane VEYL performance built from FK, seeded so the
   same beats always render the same frames. The Motion Bank later replaces these
   angles with spans of your own recorded motion. */

const GESTURE = {
  settle: { dur: 1.4, apply: (a, u) => { a.lSwing = 0.06 + u * 0.02; a.rSwing = 0.06; } },
  turn: { dur: 1.2, apply: (a, u) => { a.rootYaw = Math.sin(u * Math.PI) * 0.9; a.headYaw = Math.sin(u * Math.PI) * 0.5; } },
  point: { dur: 1.1, apply: (a, u) => {
    const k = Math.sin(Math.min(1, u * 1.3) * Math.PI * 0.5);
    a.rSwing = 0.06 + k * 1.35; a.rAbduct = 0.14 + k * 0.30; a.rElbow = 0.22 - k * 0.18; a.headPitch = -k * 0.08;
  } },
  recoil: { dur: 0.9, apply: (a, u) => {
    const k = Math.sin(u * Math.PI);
    a.spineBend = -k * 0.55; a.lean = -k * 0.4; a.lElbow = 0.22 + k * 1.1; a.rElbow = 0.22 + k * 0.9;
    a.lAbduct = 0.14 + k * 0.5; a.rAbduct = 0.14 + k * 0.5; a.headPitch = k * 0.3; a.lKnee = 0.06 + k * 0.35; a.rKnee = 0.06 + k * 0.3;
  } },
  brace: { dur: 1.0, apply: (a, u) => {
    const k = Math.sin(Math.min(1, u * 1.2) * Math.PI * 0.5);
    a.lKnee = 0.06 + k * 0.75; a.rKnee = 0.06 + k * 0.75; a.lHip = 0.02 + k * 0.5; a.rHip = -0.02 + k * 0.5;
    a.spineBend = k * 0.3; a.lElbow = 0.22 + k * 0.7; a.rElbow = 0.22 + k * 0.7; a.rootY = -k * 0.16;
  } },
  reach: { dur: 1.3, apply: (a, u) => {
    const k = Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.5);
    a.lSwing = 0.06 + k * 1.6; a.rSwing = 0.06 + k * 1.5; a.lElbow = 0.22 - k * 0.2; a.rElbow = 0.22 - k * 0.2;
    a.lAbduct = 0.14 + k * 0.2; a.rAbduct = 0.14 + k * 0.2; a.headPitch = -k * 0.22;
  } },
  cast: { dur: 0.8, apply: (a, u) => {
    const k = Math.sin(u * Math.PI);
    a.rSwing = 0.06 + k * 2.0; a.rElbow = 0.22 + (1 - k) * 0.9; a.rAbduct = 0.14 - k * 0.1;
    a.spineYaw = -k * 0.35; a.headPitch = -k * 0.18;
  } },
};

export const GESTURES = Object.keys(GESTURE);

export function synthesizePerformance({ name = 'synthetic', beats = ['settle', 'turn', 'point', 'recoil', 'settle'], world = 'nebula-drift', seed = 7, source = 'synthetic' } = {}) {
  const list = beats.map((b) => (GESTURE[b] ? b : 'settle'));
  const seconds = list.reduce((s, b) => s + GESTURE[b].dur, 0.6);
  const perf = makePerformance({ name, seconds, world, source, seed });
  const rand = rng(seed);
  const jitter = Array.from({ length: 12 }, () => rand() * 6.28318);
  const buf = new Float32Array(J * 3);
  let cursor = 0;
  const spans = list.map((b) => { const s = { beat: b, t0: cursor, t1: cursor + GESTURE[b].dur }; cursor = s.t1; return s; });

  for (let f = 0; f < perf.frames; f++) {
    const t = f / FPS;
    const a = restAngles();
    // living body underneath every beat: breath, weight shift, micro-sway
    a.rootY = Math.sin(t * 1.1 + jitter[0]) * 0.012;
    a.rootX = Math.sin(t * 0.37 + jitter[1]) * 0.03;
    a.lean = Math.sin(t * 0.44 + jitter[2]) * 0.06;
    a.spineYaw = Math.sin(t * 0.31 + jitter[3]) * 0.08;
    a.headYaw = Math.sin(t * 0.53 + jitter[4]) * 0.10;
    a.headPitch = Math.sin(t * 0.41 + jitter[5]) * 0.05;
    a.lSwing += Math.sin(t * 0.61 + jitter[6]) * 0.05;
    a.rSwing += Math.sin(t * 0.58 + jitter[7]) * 0.05;
    a.lKnee += Math.sin(t * 0.5 + jitter[8]) * 0.02;
    a.rKnee += Math.sin(t * 0.5 + jitter[9] + 1) * 0.02;

    const span = spans.find((s) => t >= s.t0 && t < s.t1) || spans[spans.length - 1];
    const u = Math.max(0, Math.min(1, (t - span.t0) / (span.t1 - span.t0)));
    // ease the beat in and out so consecutive gestures cross-fade instead of snapping
    const w = Math.min(1, Math.min(u, 1 - u) * 6);
    const before = { ...a };
    GESTURE[span.beat].apply(a, u);
    Object.keys(a).forEach((k) => { a[k] = before[k] + (a[k] - before[k]) * w; });

    fk(a, buf);
    perf.joints.set(buf, f * J * 3);
    for (let i = 0; i < J; i++) perf.vis[f * J + i] = 1;
    const fb = f * FACE_CH;
    perf.face[fb + FACE.yaw] = a.headYaw; perf.face[fb + FACE.pitch] = a.headPitch;
    perf.face[fb + FACE.roll] = Math.sin(t * 0.7 + jitter[10]) * 0.05;
    perf.face[fb + FACE.jaw] = Math.max(0, Math.sin(t * 8.3) * 0.5 + 0.18) * (span.beat === 'settle' ? 0.4 : 1);
    perf.face[fb + FACE.blinkL] = perf.face[fb + FACE.blinkR] = Math.pow(Math.max(0, Math.sin(t * 1.7 + jitter[11])), 24);
    perf.face[fb + FACE.level] = Math.max(0, Math.sin(t * 7.1) * 0.5 + 0.3);
  }
  perf.direction = spans.map((s) => ({ t: s.t0, kind: 'beat', value: s.beat }));
  return perf;
}

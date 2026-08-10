/* THE MOTION BANK — Ω.2

   Performance without performing.

   Every take in the Vault is a rig timeline: thousands of seconds of YOUR movement,
   already normalized, already metric. That corpus is an asset no other studio has,
   and this file mines it with motion matching — the proven game-industry technique,
   not a model. Index every pose by a feature vector; to build a new performance,
   walk a target trajectory and retrieve the best real continuation from the bank,
   with a continuity bonus so it prefers simply playing forward.

   No training, no weights, no hallucination. The result is unmistakably you
   because it IS you: every frame it emits was a frame you actually performed.

   Honest limit, stated in the UI as a coverage meter: the bank can only speak
   the vocabulary you have already performed. It is a library, not a dream. */
import { J, JOINT, FACE_CH, FPS, makePerformance, synthesizePerformance } from './perf';

const FEAT = 14;

/* feature vector: limb extremities relative to the hips + energy + support.
   These are the channels that make two poses feel like the same moment — the
   same set a motion-matching runtime in a shipped game would use. */
function features(joints, prev, out, o) {
  const hx = (joints[JOINT.hipL * 3] + joints[JOINT.hipR * 3]) * 0.5;
  const hy = (joints[JOINT.hipL * 3 + 1] + joints[JOINT.hipR * 3 + 1]) * 0.5;
  const hz = (joints[JOINT.hipL * 3 + 2] + joints[JOINT.hipR * 3 + 2]) * 0.5;
  const rel = (idx, axis) => joints[idx * 3 + axis] - (axis === 0 ? hx : axis === 1 ? hy : hz);
  out[o + 0] = rel(JOINT.wristL, 0); out[o + 1] = rel(JOINT.wristL, 1); out[o + 2] = rel(JOINT.wristL, 2);
  out[o + 3] = rel(JOINT.wristR, 0); out[o + 4] = rel(JOINT.wristR, 1); out[o + 5] = rel(JOINT.wristR, 2);
  out[o + 6] = rel(JOINT.ankleL, 0); out[o + 7] = rel(JOINT.ankleL, 1);
  out[o + 8] = rel(JOINT.ankleR, 0); out[o + 9] = rel(JOINT.ankleR, 1);
  out[o + 10] = rel(JOINT.nose, 0); out[o + 11] = rel(JOINT.nose, 2);
  // shoulder axis yaw — which way the body is facing
  out[o + 12] = Math.atan2(
    joints[JOINT.shoulderR * 3 + 2] - joints[JOINT.shoulderL * 3 + 2],
    joints[JOINT.shoulderR * 3] - joints[JOINT.shoulderL * 3],
  );
  // energy: total joint speed against the previous frame
  let e = 0;
  if (prev) for (let i = 0; i < J * 3; i++) { const d = joints[i] - prev[i]; e += d * d; }
  out[o + 13] = Math.sqrt(e) * 4;
}

/* channel weights: hands and facing dominate how a pose reads on camera */
const WEIGHTS = new Float32Array([1.5, 1.5, 1.2, 1.5, 1.5, 1.2, 0.7, 0.9, 0.7, 0.9, 0.6, 0.6, 1.8, 1.1]);

/** index a set of `.veyl` performances into a searchable bank */
export function buildBank(performances) {
  const usable = performances.filter((p) => p && p.frames > 4 && p.joints && p.joints.length >= p.frames * J * 3);
  let total = 0;
  usable.forEach((p) => { total += p.frames; });
  const feat = new Float32Array(Math.max(1, total) * FEAT);
  const owner = new Int32Array(Math.max(1, total));      // index into `usable`
  const localFrame = new Int32Array(Math.max(1, total));
  const tag = new Array(Math.max(1, total)).fill('idle');

  let w = 0;
  usable.forEach((p, pi) => {
    const beats = (p.direction || []).filter((d) => d.kind === 'beat');
    let prev = null;
    for (let f = 0; f < p.frames; f++) {
      const cur = p.joints.subarray(f * J * 3, f * J * 3 + J * 3);
      features(cur, prev, feat, w * FEAT);
      owner[w] = pi; localFrame[w] = f;
      const t = f / p.fps;
      let label = 'idle';
      for (let i = 0; i < beats.length; i++) if (t >= beats[i].t) label = beats[i].value;
      tag[w] = label;
      prev = cur;
      w++;
    }
  });

  return {
    performances: usable, feat, owner, localFrame, tag, count: w, FEAT,
    seconds: w / FPS,
    coverage() {
      const c = {};
      for (let i = 0; i < w; i++) c[tag[i]] = (c[tag[i]] || 0) + 1;
      Object.keys(c).forEach((k) => { c[k] = c[k] / FPS; });
      return c;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Ω.2b — LEARNED CONTINUATION (the gated upgrade, the fallback layer)

   The last and only trained component in the plan, and the only one the plan
   can live entirely without. A tiny per-channel AR(2) motion model — next
   frame from the two before it — fit by ridge-regularized least squares over
   every frame in YOUR bank, in-browser, in milliseconds, deterministic (no
   random init: closed-form normal equations, same corpus = same weights).

   It never replaces the bank. It fills the seams: where motion matching cuts
   between two spans, the model free-runs the outgoing motion's momentum and
   eases it into the incoming span — a transition the bank itself lacks —
   instead of a straight-line blend. Gated on corpus size; below the gate the
   linear blend remains, and behavior degrades to exactly what shipped. */

const CONT_MIN_SECONDS = 8;    // the gate: don't fit a model to a corpus this small
const CONT_RIDGE = 1e-3;

/** fit the continuation model over the bank. Returns null when gated off. */
export function trainContinuation(bank, { minSeconds = CONT_MIN_SECONDS, ridge = CONT_RIDGE } = {}) {
  if (!bank || !bank.count || bank.seconds < minSeconds) return null;
  const C = J * 3;
  const coef = new Float64Array(C * 3);      // per channel: [a (x_t), b (x_{t-1}), c (bias)]
  // per-channel 3x3 normal equations, accumulated across every span in the bank
  const XtX = new Float64Array(C * 9);
  const Xty = new Float64Array(C * 3);
  let samples = 0;
  bank.performances.forEach((p) => {
    for (let f = 2; f < p.frames; f++) {
      const a0 = (f - 2) * C, a1 = (f - 1) * C, a2 = f * C;
      for (let c = 0; c < C; c++) {
        const x0 = p.joints[a0 + c], x1 = p.joints[a1 + c], y = p.joints[a2 + c];
        const m = c * 9, v = c * 3;
        XtX[m + 0] += x1 * x1; XtX[m + 1] += x1 * x0; XtX[m + 2] += x1;
        XtX[m + 3] += x0 * x1; XtX[m + 4] += x0 * x0; XtX[m + 5] += x0;
        XtX[m + 6] += x1;      XtX[m + 7] += x0;      XtX[m + 8] += 1;
        Xty[v + 0] += x1 * y;  Xty[v + 1] += x0 * y;  Xty[v + 2] += y;
      }
      samples++;
    }
  });
  if (samples < FPS) return null;
  // solve each 3x3 (ridge on the diagonal) by Cramer's rule
  for (let c = 0; c < C; c++) {
    const m = c * 9, v = c * 3;
    const a = XtX[m] + ridge, b = XtX[m + 1], cc = XtX[m + 2];
    const d = XtX[m + 3], e = XtX[m + 4] + ridge, f2 = XtX[m + 5];
    const g = XtX[m + 6], h = XtX[m + 7], i2 = XtX[m + 8] + ridge;
    const det = a * (e * i2 - f2 * h) - b * (d * i2 - f2 * g) + cc * (d * h - e * g);
    if (Math.abs(det) < 1e-12) { coef[v] = 1; coef[v + 1] = 0; coef[v + 2] = 0; continue; }
    const y0 = Xty[v], y1 = Xty[v + 1], y2 = Xty[v + 2];
    coef[v + 0] = (y0 * (e * i2 - f2 * h) - b * (y1 * i2 - f2 * y2) + cc * (y1 * h - e * y2)) / det;
    coef[v + 1] = (a * (y1 * i2 - f2 * y2) - y0 * (d * i2 - f2 * g) + cc * (d * y2 - y1 * g)) / det;
    coef[v + 2] = (a * (e * y2 - y1 * h) - b * (d * y2 - y1 * g) + y0 * (d * h - e * g)) / det;
  }
  return { coef, channels: C, order: 2, corpus: bank.seconds, samples };
}

/**
 * free-run the model from two poses and ease into a target pose over `steps`
 * frames — a momentum-preserving transition instead of a straight line.
 * Deterministic: no sampling, no noise. Returns steps × (J*3) floats.
 */
export function continueMotion(model, prevPose, curPose, steps, targetPose) {
  const C = model.channels;
  const out = new Float32Array(steps * C);
  let x0 = Float64Array.from(prevPose);
  let x1 = Float64Array.from(curPose);
  for (let s = 0; s < steps; s++) {
    const nx = new Float64Array(C);
    for (let c = 0; c < C; c++) {
      const v = c * 3;
      nx[c] = model.coef[v] * x1[c] + model.coef[v + 1] * x0[c] + model.coef[v + 2];
    }
    if (targetPose) {
      const k = (s + 1) / (steps + 1);
      const w = k * k * (3 - 2 * k);          // smoothstep into the incoming span
      for (let c = 0; c < C; c++) nx[c] = nx[c] * (1 - w) + targetPose[c] * w;
    }
    for (let c = 0; c < C; c++) out[s * C + c] = nx[c];
    x0 = x1; x1 = nx;
  }
  return out;
}

function cost(bank, i, target, to) {
  let s = 0;
  const b = i * FEAT;
  for (let c = 0; c < FEAT; c++) { const d = bank.feat[b + c] - target[to + c]; s += d * d * WEIGHTS[c]; }
  return s;
}

/**
 * ASSEMBLE — beats in, a performance made of your own recorded frames out.
 *
 * The beat list is first turned into a synthetic target trajectory (cheap, FK,
 * deterministic). That target is never rendered; it is only the query. Frame by
 * frame the bank is searched for the closest real pose, with a strong bonus for
 * continuing the span it is already playing, so the output is long runs of genuine
 * motion joined at phase-matched points — not a per-frame nearest-neighbour mush.
 */
export function assemble(bank, { beats = ['settle', 'turn', 'point', 'settle'], name = 'bank-shot', world = 'nebula-drift', seed = 11, continuity = 0.55, blendFrames = 5, continuation = null } = {}) {
  if (!bank || !bank.count) return null;
  const target = synthesizePerformance({ name: 'query', beats, world, seed });
  const tFeat = new Float32Array(target.frames * FEAT);
  let prev = null;
  for (let f = 0; f < target.frames; f++) {
    const cur = target.joints.subarray(f * J * 3, f * J * 3 + J * 3);
    features(cur, prev, tFeat, f * FEAT);
    prev = cur;
  }

  const out = makePerformance({ name, seconds: target.frames / FPS, world, source: 'bank', seed });
  const tagOf = (f) => {
    const beatList = target.direction;
    const t = f / FPS;
    let label = 'idle';
    for (let i = 0; i < beatList.length; i++) if (t >= beatList[i].t) label = beatList[i].value;
    return label;
  };

  let playing = -1;                 // bank index currently being played forward
  let sinceCut = 1e6;
  const picks = new Int32Array(out.frames);

  for (let f = 0; f < out.frames; f++) {
    const want = tagOf(f);
    let best = -1, bestCost = Infinity;
    // candidate 1: keep playing the current span (free continuity)
    if (playing >= 0) {
      const nxt = playing + 1;
      if (nxt < bank.count && bank.owner[nxt] === bank.owner[playing]) {
        best = nxt;
        bestCost = cost(bank, nxt, tFeat, f * FEAT) * (1 - continuity);
      }
    }
    // candidate 2: search the bank, preferring frames tagged with the beat we want
    for (let i = 0; i < bank.count - 1; i++) {
      if (bank.owner[i] !== bank.owner[i + 1]) continue;          // never start on a span edge
      let c = cost(bank, i, tFeat, f * FEAT);
      if (bank.tag[i] !== want) c *= 1.45;                        // soft tag preference
      if (sinceCut < blendFrames * 2) c *= 1.6;                   // discourage rapid re-cutting
      if (c < bestCost) { bestCost = c; best = i; }
    }
    if (best < 0) best = 0;
    if (playing < 0 || best !== playing + 1) sinceCut = 0; else sinceCut++;
    playing = best;
    picks[f] = best;
  }

  /* write the retrieved frames, cross-fading across every cut so a span change
     is a blend, not a pop */
  for (let f = 0; f < out.frames; f++) {
    const i = picks[f];
    const p = bank.performances[bank.owner[i]];
    const lf = bank.localFrame[i];
    const src = p.joints.subarray(lf * J * 3, lf * J * 3 + J * 3);
    out.joints.set(src, f * J * 3);
    const fsrc = p.face.subarray(lf * FACE_CH, lf * FACE_CH + FACE_CH);
    if (fsrc.length === FACE_CH) out.face.set(fsrc, f * FACE_CH);
    for (let k = 0; k < J; k++) out.vis[f * J + k] = p.vis[lf * J + k] || 1;
  }
  let continuationCuts = 0;
  for (let f = 1; f < out.frames; f++) {
    if (picks[f] === picks[f - 1] + 1) continue;
    /* Ω.2b: where the model exists, the seam is a momentum-preserving
       continuation eased into the incoming span — never a straight line.
       Where it doesn't (gated), the linear blend below remains, unchanged. */
    if (continuation && f >= 2 && f + blendFrames < out.frames) {
      const C = J * 3;
      const gen = continueMotion(
        continuation,
        out.joints.subarray((f - 2) * C, (f - 2) * C + C),
        out.joints.subarray((f - 1) * C, (f - 1) * C + C),
        blendFrames,
        out.joints.subarray((f + blendFrames) * C, (f + blendFrames) * C + C),
      );
      for (let b = 0; b < blendFrames; b++) out.joints.set(gen.subarray(b * C, (b + 1) * C), (f + b) * C);
      continuationCuts++;
      continue;
    }
    for (let b = 1; b <= blendFrames && f + b < out.frames; b++) {
      const k = b / (blendFrames + 1);
      const a = (f - 1) * J * 3, c = (f + b) * J * 3;
      for (let i = 0; i < J * 3; i++) out.joints[c + i] = out.joints[a + i] * (1 - k) + out.joints[c + i] * k;
    }
  }
  out.direction = target.direction.map((d) => ({ ...d }));
  out.direction.push({ t: 0, kind: 'bank', value: `${bank.performances.length} takes · ${bank.seconds.toFixed(1)}s indexed` });
  if (continuation && continuationCuts > 0) {
    out.direction.push({ t: 0, kind: 'continuation', value: `AR2 · ${continuationCuts} seams · trained on ${continuation.corpus.toFixed(1)}s` });
  }
  return out;
}

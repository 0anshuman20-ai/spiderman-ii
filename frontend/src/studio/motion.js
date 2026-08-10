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
export function assemble(bank, { beats = ['settle', 'turn', 'point', 'settle'], name = 'bank-shot', world = 'nebula-drift', seed = 11, continuity = 0.55, blendFrames = 5 } = {}) {
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
  for (let f = 1; f < out.frames; f++) {
    if (picks[f] === picks[f - 1] + 1) continue;
    for (let b = 1; b <= blendFrames && f + b < out.frames; b++) {
      const k = b / (blendFrames + 1);
      const a = (f - 1) * J * 3, c = (f + b) * J * 3;
      for (let i = 0; i < J * 3; i++) out.joints[c + i] = out.joints[a + i] * (1 - k) + out.joints[c + i] * k;
    }
  }
  out.direction = target.direction.map((d) => ({ ...d }));
  out.direction.push({ t: 0, kind: 'bank', value: `${bank.performances.length} takes · ${bank.seconds.toFixed(1)}s indexed` });
  return out;
}

/* THE SYNTHETIC ACTOR — Ω.1

   The camera stops being required.

   The live studio paints the suit onto your real webcam pixels. That is Inversion 2,
   and it can only ever show the one angle the webcam held. This is the other body:
   a fully 3D suited VEYL, real geometry in the same world the stage already renders,
   driven by a `.veyl` Performance File instead of a video frame. Because it is
   geometry, the camera is free — crane wide, low hero, over-shoulder, 180° orbit,
   forty metres away on a rooftop — and one recorded performance becomes coverage.

   Everything is procedural: no downloaded rig, no GLB, no asset budget, $0.
   Retarget is deterministic (bone-length normalization + foot lock + confidence
   fallback), so the same performance and the same camera always render the same
   frames — which is the only reason a synthetic shot can be trusted in a cut. */
import * as THREE from 'three';
import { J, JOINT, REST, FACE, fk, restAngles } from './perf';

const RED = '#7d1016';
const RED_LIT = '#a4151d';
const BLUE = '#101c47';
const BLUE_LIT = '#17275e';
const WEB = 'rgba(6,6,10,0.94)';

/* ------------------------------------------------------------------ */
/* procedural costume textures — hex-weave red, twill blue, rubber webbing */

function noiseWash(g, size, amount) {
  for (let i = 0; i < size * size * 0.045; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 6 + Math.random() * 26;
    g.globalAlpha = Math.random() * amount;
    g.fillStyle = Math.random() > 0.5 ? '#ffffff' : '#000000';
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
}

function webLines(g, size, spacing, spokes) {
  const c = size / 2;
  g.strokeStyle = WEB;
  g.lineCap = 'round';
  g.lineWidth = Math.max(1.5, size * 0.008);
  for (let r = spacing; r < size * 0.95; r += spacing) {
    g.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.06) {
      // hand-worn wobble: rings breathe so nothing reads as vector art
      const rr = r * (1 + Math.sin(a * 3.1 + r * 0.07) * 0.022);
      const x = c + Math.cos(a) * rr, y = c + Math.sin(a) * rr;
      if (a === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    g.beginPath();
    g.moveTo(c, c);
    g.lineTo(c + Math.cos(a) * size, c + Math.sin(a) * size);
    g.stroke();
  }
}

function hexWeave(g, size) {
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.lineWidth = 1;
  const s = 7, h = s * 0.866;
  for (let y = 0, row = 0; y < size + h; y += h, row++) {
    for (let x = (row % 2) * s * 0.75; x < size + s; x += s * 1.5) {
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const px = x + Math.cos(a) * s * 0.45, py = y + Math.sin(a) * s * 0.45;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath(); g.stroke();
    }
  }
}

function twill(g, size) {
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.lineWidth = 1;
  for (let i = -size; i < size * 2; i += 5) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + size, size); g.stroke();
  }
  g.strokeStyle = 'rgba(0,0,0,0.10)';
  for (let i = -size; i < size * 2; i += 5) {
    g.beginPath(); g.moveTo(i + size, 0); g.lineTo(i, size); g.stroke();
  }
}

const texCache = {};
function suitTexture(kind) {
  if (texCache[kind]) return texCache[kind];
  const size = 512;
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const blue = kind === 'blue';
  const grad = g.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, blue ? BLUE_LIT : RED_LIT);
  grad.addColorStop(1, blue ? BLUE : RED);
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  noiseWash(g, size, blue ? 0.05 : 0.07);
  if (blue) twill(g, size); else hexWeave(g, size);
  if (kind === 'red-web') webLines(g, size, size / 7, 16);
  if (kind === 'red-web-tight') webLines(g, size, size / 11, 12);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  texCache[kind] = t;
  return t;
}

function suitMaterial(kind) {
  const map = suitTexture(kind);
  return new THREE.MeshStandardMaterial({
    map, bumpMap: map, bumpScale: 0.9,
    roughness: kind === 'blue' ? 0.62 : 0.52,
    metalness: 0.06,
  });
}

/* teardrop lens, in unit space, +x outward — same silhouette as the AR compositor */
function lensShape() {
  const s = new THREE.Shape();
  s.moveTo(-0.92, 0.5);
  s.bezierCurveTo(-1.1, -0.25, -0.55, -0.88, 0.12, -0.82);
  s.bezierCurveTo(0.9, -0.74, 1.14, -0.12, 0.82, 0.34);
  s.bezierCurveTo(0.44, 0.88, -0.52, 0.92, -0.92, 0.5);
  return s;
}

function spiderTexture() {
  if (texCache.spider) return texCache.spider;
  const size = 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, size, size);
  const c = size / 2, s = size * 0.42;
  g.strokeStyle = 'rgba(4,4,8,0.96)'; g.fillStyle = 'rgba(4,4,8,0.96)';
  g.lineWidth = s * 0.075; g.lineCap = 'round';
  const legs = [{ y: -0.30, e: -0.62 }, { y: -0.13, e: -0.34 }, { y: 0.03, e: 0.30 }, { y: 0.18, e: 0.66 }];
  [-1, 1].forEach((side) => legs.forEach(({ y, e }) => {
    g.beginPath();
    g.moveTo(c + side * s * 0.07, c + y * s);
    g.quadraticCurveTo(c + side * s * 0.5, c + (y + e * 0.2) * s, c + side * s * 0.85, c + (y + e * 0.6) * s);
    g.stroke();
  }));
  g.beginPath(); g.ellipse(c, c - s * 0.16, s * 0.10, s * 0.17, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(c, c + s * 0.16, s * 0.13, s * 0.27, 0, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.spider = t;
  return t;
}

/* ------------------------------------------------------------------ */
/* bone rig: every limb is a capsule aimed down its own joint pair      */

const BONES = [
  { id: 'pelvis', a: JOINT.hipL, b: JOINT.hipR, r: 0.115, kind: 'blue', squash: [1, 1, 0.78] },
  { id: 'torso', a: 'hipC', b: 'shoulderC', r: 0.155, kind: 'red-web', squash: [1.24, 1, 0.74] },
  { id: 'abdomen', a: 'hipC', b: 'chest', r: 0.14, kind: 'blue', squash: [1.1, 1, 0.7] },
  { id: 'clavL', a: 'shoulderC', b: JOINT.shoulderL, r: 0.072, kind: 'red-web-tight' },
  { id: 'clavR', a: 'shoulderC', b: JOINT.shoulderR, r: 0.072, kind: 'red-web-tight' },
  { id: 'upArmL', a: JOINT.shoulderL, b: JOINT.elbowL, r: 0.058, kind: 'red-web-tight' },
  { id: 'upArmR', a: JOINT.shoulderR, b: JOINT.elbowR, r: 0.058, kind: 'red-web-tight' },
  { id: 'foreL', a: JOINT.elbowL, b: JOINT.wristL, r: 0.049, kind: 'blue' },
  { id: 'foreR', a: JOINT.elbowR, b: JOINT.wristR, r: 0.049, kind: 'blue' },
  { id: 'handL', a: JOINT.wristL, b: JOINT.handL, r: 0.052, kind: 'red-web-tight', squash: [1, 1, 0.62] },
  { id: 'handR', a: JOINT.wristR, b: JOINT.handR, r: 0.052, kind: 'red-web-tight', squash: [1, 1, 0.62] },
  { id: 'thighL', a: JOINT.hipL, b: JOINT.kneeL, r: 0.082, kind: 'blue' },
  { id: 'thighR', a: JOINT.hipR, b: JOINT.kneeR, r: 0.082, kind: 'blue' },
  { id: 'shinL', a: JOINT.kneeL, b: JOINT.ankleL, r: 0.064, kind: 'blue' },
  { id: 'shinR', a: JOINT.kneeR, b: JOINT.ankleR, r: 0.064, kind: 'blue' },
  { id: 'footL', a: JOINT.ankleL, b: JOINT.toeL, r: 0.055, kind: 'red-web-tight', squash: [1, 1, 1.15] },
  { id: 'footR', a: JOINT.ankleR, b: JOINT.toeR, r: 0.055, kind: 'red-web-tight', squash: [1, 1, 1.15] },
  { id: 'neck', a: 'shoulderC', b: 'headBase', r: 0.055, kind: 'red-web-tight' },
];

const UP = new THREE.Vector3(0, 1, 0);

export function createActor() {
  const group = new THREE.Group();
  const bones = {};
  const mats = new Map();
  const getMat = (kind) => { if (!mats.has(kind)) mats.set(kind, suitMaterial(kind)); return mats.get(kind); };

  BONES.forEach((b) => {
    const geo = new THREE.CapsuleGeometry(b.r, 1, 6, 12);
    const mesh = new THREE.Mesh(geo, getMat(b.kind));
    mesh.castShadow = mesh.receiveShadow = false;
    const holder = new THREE.Group();
    holder.add(mesh);
    if (b.squash) mesh.scale.set(b.squash[0], 1, b.squash[2]);
    group.add(holder);
    bones[b.id] = { def: b, holder, mesh };
  });

  /* ---- head: mask ellipsoid + teardrop lenses + jaw seam ---- */
  const head = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(REST.head, 28, 22), getMat('red-web'));
  skull.scale.set(0.94, 1.3, 1.02);
  head.add(skull);

  const lensMat = new THREE.MeshStandardMaterial({
    color: 0xf4f7ff, roughness: 0.13, metalness: 0.0,
    emissive: 0x8f9bd6, emissiveIntensity: 0.22,
  });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x07070b, roughness: 0.42, metalness: 0.3 });
  const lensGeo = new THREE.ShapeGeometry(lensShape(), 24);
  const lenses = [-1, 1].map((side) => {
    const g = new THREE.Group();
    const rim = new THREE.Mesh(lensGeo, rimMat);
    rim.scale.set(1.26 * side, 1.3, 1);
    rim.position.z = -0.004;
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.scale.set(side, 1, 1);
    g.add(rim); g.add(lens);
    g.scale.setScalar(REST.head * 0.42);
    g.position.set(side * REST.head * 0.44, REST.head * 0.12, REST.head * 0.86);
    head.add(g);
    return g;
  });
  group.add(head);

  /* ---- chest emblem ---- */
  const emblem = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.2),
    new THREE.MeshStandardMaterial({ map: spiderTexture(), transparent: true, roughness: 0.35, metalness: 0.1, depthWrite: false }),
  );
  emblem.renderOrder = 2;
  group.add(emblem);

  /* ---- world-coupled rim so a synthetic shot grades like a matted one ---- */
  const rim = new THREE.DirectionalLight(0x7a5aff, 1.6);
  rim.position.set(-1.4, 2.0, -2.2);
  group.add(rim);
  const key = new THREE.SpotLight(0xffffff, 26, 12, 0.9, 0.6, 1.6);
  key.position.set(-1.8, 3.0, 2.4);
  group.add(key);
  const keyTarget = new THREE.Object3D();
  keyTarget.position.set(0, 1.2, 0);
  group.add(keyTarget);
  key.target = keyTarget;

  /* ---- retarget state ---- */
  const raw = new Float32Array(J * 3);
  const smooth = new Float32Array(J * 3);
  const fallback = new Float32Array(J * 3);
  fk(restAngles(), fallback);
  let primed = false;

  const v = (i, out) => out.set(smooth[i * 3], smooth[i * 3 + 1], smooth[i * 3 + 2]);
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
  const hipC = new THREE.Vector3(), shoulderC = new THREE.Vector3(), chest = new THREE.Vector3(), headBase = new THREE.Vector3();
  const q = new THREE.Quaternion(), dir = new THREE.Vector3();

  function point(ref, out) {
    if (ref === 'hipC') return out.copy(hipC);
    if (ref === 'shoulderC') return out.copy(shoulderC);
    if (ref === 'chest') return out.copy(chest);
    if (ref === 'headBase') return out.copy(headBase);
    return v(ref, out);
  }

  function aimBone(b, a, c) {
    dir.subVectors(c, a);
    const len = Math.max(0.02, dir.length());
    b.holder.position.copy(a).addScaledVector(dir, 0.5);
    q.setFromUnitVectors(UP, dir.divideScalar(len));
    b.holder.quaternion.copy(q);
    // capsule geometry is built with height 1, so scaling y alone keeps the caps round
    b.mesh.scale.y = Math.max(0.05, len);
  }

  const actor = {
    group, head,

    /** the world's dominant light colour, so CG and matted shots share a rim */
    setRim(hex) { rim.color.setHex(hex); },
    setKey(intensity) { key.intensity = intensity; },

    /** metres of hip travel applied to the actor root — the shot can lock it off */
    rootLock: false,

    /**
     * Retarget one performance frame onto the suit.
     * @param joints Float32Array(99) metric joints, hips-centred, y up
     * @param face   Float32Array(FACE_CH) head + expression signals
     * @param conf   0..1 mean landmark visibility for this frame
     * @param smoothing 0..1, 1 = snap (offline renders snap; live preview eases)
     * @param root   {x,y,z} when something else owns the body (a stunt takeover
     *               window); null lets the foot lock own the floor
     */
    applyPose(joints, face, conf = 1, smoothing = 0.55, root = null) {
      raw.set(joints);

      /* confidence fallback: a limb the solve could not see must return to the
         procedural rest body, never flail. This is the single difference between
         a synthetic shot that reads as a performance and one that reads as a bug. */
      const trust = Math.max(0, Math.min(1, (conf - 0.15) / 0.5));
      for (let i = 0; i < J * 3; i++) raw[i] = raw[i] * trust + fallback[i] * (1 - trust);

      /* bone-length normalization: your shoulders, VEYL's proportions */
      const shoulderSpan = Math.hypot(
        raw[JOINT.shoulderR * 3] - raw[JOINT.shoulderL * 3],
        raw[JOINT.shoulderR * 3 + 1] - raw[JOINT.shoulderL * 3 + 1],
        raw[JOINT.shoulderR * 3 + 2] - raw[JOINT.shoulderL * 3 + 2],
      );
      const scale = shoulderSpan > 0.05 ? (REST.shoulderHalf * 2) / shoulderSpan : 1;
      for (let i = 0; i < J * 3; i++) raw[i] *= scale;

      if (!primed) { smooth.set(raw); primed = true; }
      else { const k = Math.max(0.02, Math.min(1, smoothing)); for (let i = 0; i < J * 3; i++) smooth[i] += (raw[i] - smooth[i]) * k; }

      /* derived spine points */
      v(JOINT.hipL, tmpA); v(JOINT.hipR, tmpB);
      hipC.addVectors(tmpA, tmpB).multiplyScalar(0.5);
      v(JOINT.shoulderL, tmpA); v(JOINT.shoulderR, tmpB);
      shoulderC.addVectors(tmpA, tmpB).multiplyScalar(0.5);
      chest.lerpVectors(hipC, shoulderC, 0.62);
      headBase.copy(shoulderC).addScaledVector(tmpC.subVectors(shoulderC, hipC).normalize(), 0.11);

      /* Root ownership, in priority order:
         1. an explicit root — the Stunt Engine has taken the body off the floor,
            so physics owns translation and the foot lock must not fight it;
         2. rootLock — hips pinned at standing height (turntables, reverse angles);
         3. otherwise the lower foot owns the floor, so contact stops sliding. */
      if (root) {
        group.position.set(root.x, root.y, root.z);
      } else {
        const footY = Math.min(smooth[JOINT.ankleL * 3 + 1], smooth[JOINT.ankleR * 3 + 1]);
        group.position.set(0, actor.rootLock ? REST.groundY - REST.thigh - REST.shin : -footY, 0);
      }

      BONES.forEach((def) => {
        const b = bones[def.id];
        point(def.a, tmpA); point(def.b, tmpB);
        aimBone(b, tmpA, tmpB);
      });

      /* head basis from the ear axis and the nose — real gaze, not a guess */
      v(JOINT.earL, tmpA); v(JOINT.earR, tmpB); v(JOINT.nose, tmpC);
      const headCenter = tmpA.clone().add(tmpB).multiplyScalar(0.5);
      const right = tmpB.clone().sub(tmpA).normalize();
      const forward = tmpC.clone().sub(headCenter).normalize();
      const up = right.clone().cross(forward).normalize().multiplyScalar(-1);
      const m = new THREE.Matrix4().makeBasis(right, up, forward);
      head.position.copy(headCenter).addScaledVector(up, REST.head * 0.12);
      head.quaternion.setFromRotationMatrix(m);

      /* expression drives the lenses exactly like the AR compositor's EXPR table */
      if (face) {
        const brow = face[FACE.brow] || 0;
        const blink = Math.max(face[FACE.blinkL] || 0, face[FACE.blinkR] || 0);
        const squash = Math.max(0.16, 1 - blink * 0.7 - Math.max(0, -brow) * 0.35);
        const glow = 0.18 + (face[FACE.level] || 0) * 0.3 + Math.max(0, -brow) * 0.25;
        lenses.forEach((l) => { l.scale.y = REST.head * 0.42 * squash; });
        lensMat.emissiveIntensity = glow;
      }

      /* emblem rides the chest plane, facing wherever the torso faces */
      emblem.position.copy(chest).addScaledVector(forward, 0.125);
      emblem.quaternion.copy(head.quaternion);
      keyTarget.position.copy(chest);
    },

    /** procedural idle — used when a shot has no performance attached yet */
    idle(t) {
      const a = restAngles();
      a.rootY = Math.sin(t * 1.1) * 0.012;
      a.spineYaw = Math.sin(t * 0.31) * 0.09;
      a.headYaw = Math.sin(t * 0.53) * 0.12;
      a.lSwing = 0.06 + Math.sin(t * 0.6) * 0.05;
      a.rSwing = 0.06 + Math.sin(t * 0.57 + 1) * 0.05;
      fk(a, raw);
      actor.applyPose(raw, null, 1, 0.35);
    },

    dispose() {
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      mats.forEach((m) => m.dispose());
      lensMat.dispose(); rimMat.dispose();
      lensGeo.dispose();
    },
  };

  return actor;
}

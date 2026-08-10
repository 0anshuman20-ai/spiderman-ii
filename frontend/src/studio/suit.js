/* The suit compositor — a true AR filter.
   Your real webcam pixels ARE the suit: a GPU shader recolors your body into the
   red/blue costume with black webbing while preserving your actual lighting, shadows,
   wrinkles and facial motion. When you open your mouth, the mask visibly moves,
   because it is literally your video. Landmark-locked white lenses and a chest
   spider are drawn on top. The AI person-matte cuts your room away so the 3D
   space world shows behind you. */
import * as THREE from 'three';
import { CROP_W, CROP_H } from './tracking';

const ASPECT = CROP_H / CROP_W; // aspect-corrected y so distances are true

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVideo;
  uniform sampler2D uMask;
  uniform float uHasMask;
  uniform float uTime;
  uniform vec2 uFaceC;      // face center, aspect-corrected top-down
  uniform float uFaceR;     // face radius (aspect-corrected)
  uniform float uFaceRoll;
  uniform float uFaceOk;
  uniform vec2 uChest;      // chest web origin
  uniform float uChestS;    // body web spacing
  uniform float uPoseOk;
  uniform vec4 uSegs[10];   // limb segments a.xy -> b.xy
  uniform float uSegCol[10];// 0 red, 1 blue, 2 shin(blue->red boot), 4 torso(red, blue sides)
  uniform float uSegR[10];  // segment radius
  uniform vec3 uRim;        // world rim-light color
  uniform float uSuitMix;   // 0 raw video -> 1 full suit

  const vec3 RED = vec3(0.66, 0.045, 0.075);
  const vec3 BLUE = vec3(0.055, 0.10, 0.34);

  // spider-web pattern: concentric rings + radial spokes around a center
  float webLines(vec2 q, vec2 c, float roll, float spacing, float radial) {
    vec2 d = q - c;
    float cs = cos(roll), sn = sin(roll);
    d = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
    float r = length(d);
    float ang = atan(d.y, d.x);
    float lw = spacing * 0.075;
    float ringD = abs(fract(r / spacing + 0.5) - 0.5) * spacing;
    float ring = 1.0 - smoothstep(lw * 0.45, lw, ringD);
    float sector = 6.28318530 / radial;
    float arcD = abs(fract(ang / sector + 0.5) - 0.5) * sector * max(r, 1e-4);
    float spoke = 1.0 - smoothstep(lw * 0.45, lw, arcD);
    return max(ring, spoke);
  }

  void main() {
    vec2 pt = vec2(vUv.x, 1.0 - vUv.y);        // top-down, matches landmarks
    vec2 q = vec2(pt.x, pt.y * ${ASPECT.toFixed(5)});

    vec4 video = texture2D(uVideo, vUv);
    float m = uHasMask > 0.5 ? texture2D(uMask, vec2(vUv.x, 1.0 - vUv.y)).r : 1.0;
    float alpha = smoothstep(0.32, 0.62, m);
    if (alpha < 0.004) discard;

    // ---- region classification against the live skeleton ----
    float best = 1e9; float bid = 0.0; float bt = 0.0;
    for (int i = 0; i < 10; i++) {
      vec2 a = uSegs[i].xy, b = uSegs[i].zw;
      vec2 ba = b - a; vec2 pa = q - a;
      float tt = clamp(dot(pa, ba) / (dot(ba, ba) + 1e-6), 0.0, 1.0);
      float d = length(pa - ba * tt) / max(uSegR[i], 1e-4);
      if (d < best) { best = d; bid = uSegCol[i]; bt = tt; }
    }
    float dHead = length(q - uFaceC);
    bool isHead = uFaceOk > 0.3 && dHead < uFaceR * 2.05;
    if (isHead) bid = 3.0;
    if (uPoseOk < 0.3 && !isHead) { bid = 0.0; best = 0.5; }

    // ---- base color per region ----
    vec3 base;
    float web = 0.0;
    if (bid == 3.0 || isHead) {
      base = RED;
      web = webLines(q, uFaceC, uFaceRoll, max(uFaceR, 0.02) * 0.42, 14.0);
      web *= smoothstep(2.05, 1.7, dHead / max(uFaceR, 1e-4)); // fade at mask edge
    } else if (bid == 1.0) {
      base = BLUE;
    } else if (bid == 2.0) {
      base = mix(BLUE, RED, smoothstep(0.52, 0.70, bt)); // boots
      web = webLines(q, uChest, 0.0, max(uChestS, 0.03) * 0.5, 18.0) * smoothstep(0.52, 0.72, bt);
    } else if (bid == 4.0) {
      base = mix(RED, BLUE, smoothstep(0.74, 0.97, best)); // blue flanks
      web = webLines(q, uChest, 0.0, max(uChestS, 0.03) * 0.5, 18.0) * (1.0 - smoothstep(0.70, 0.95, best));
    } else {
      base = RED;
      web = webLines(q, uChest, 0.0, max(uChestS, 0.03) * 0.5, 18.0);
    }

    // ---- relight the suit with YOUR real shading ----
    float luma = dot(video.rgb, vec3(0.299, 0.587, 0.114));
    float shade = 0.20 + 1.75 * pow(luma, 0.85);
    vec3 suit = base * shade;
    suit += vec3(1.0, 0.86, 0.8) * pow(luma, 5.0) * 0.55;          // fabric sheen
    suit = mix(suit, suit * 0.10, clamp(web, 0.0, 1.0) * 0.92);    // black webbing
    float fab = sin(q.x * 1500.0) * sin(q.y * 1500.0);             // micro-weave
    suit *= 1.0 + fab * 0.03;

    vec3 col = mix(video.rgb, suit, uSuitMix);

    // rim light from the space world wraps around your silhouette
    float rimB = smoothstep(0.32, 0.5, m) * (1.0 - smoothstep(0.5, 0.8, m));
    col += uRim * rimB * (0.5 + 0.2 * sin(uTime * 1.7));

    gl_FragColor = vec4(col, alpha);
  }
`;

/* teardrop spider lens path in unit space (right-eye orientation, +x = outward) */
function lensPath(g) {
  g.beginPath();
  g.moveTo(-0.92, 0.5);
  g.bezierCurveTo(-1.1, -0.25, -0.55, -0.88, 0.12, -0.82);
  g.bezierCurveTo(0.9, -0.74, 1.14, -0.12, 0.82, 0.34);
  g.bezierCurveTo(0.44, 0.88, -0.52, 0.92, -0.92, 0.5);
  g.closePath();
}

function drawLens(g, x, y, size, angle, mirror, squash, glow) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.scale(mirror * size, size * Math.max(0.12, squash));
  if (glow > 1.15) { g.shadowColor = 'rgba(255,255,255,0.85)'; g.shadowBlur = size * 0.5 * glow; }
  // black rim
  g.lineJoin = 'round';
  lensPath(g);
  g.fillStyle = '#07070c';
  g.save(); g.scale(1.24, 1.3); lensPath(g); g.fill(); g.restore();
  // white lens with cool gradient
  const gr = g.createLinearGradient(-1, -1, 0.8, 1);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.55, '#eef1f8'); gr.addColorStop(1, '#c9d2e4');
  lensPath(g);
  g.fillStyle = gr; g.fill();
  g.restore();
}

function drawSpider(g, x, y, s, ang) {
  g.save();
  g.translate(x, y); g.rotate(ang);
  g.strokeStyle = 'rgba(4,4,8,0.94)'; g.fillStyle = 'rgba(4,4,8,0.94)';
  g.lineWidth = s * 0.075; g.lineCap = 'round';
  const legs = [
    { y: -0.30, b1: -0.34, e: -0.62 }, { y: -0.13, b1: -0.16, e: -0.34 },
    { y: 0.03, b1: 0.10, e: 0.30 }, { y: 0.18, b1: 0.34, e: 0.66 },
  ];
  [-1, 1].forEach((side) => {
    legs.forEach(({ y: ly, b1, e }) => {
      g.beginPath();
      g.moveTo(side * s * 0.07, ly * s);
      g.quadraticCurveTo(side * s * 0.5, (ly + b1 * 0.4) * s, side * s * 0.85, (ly + e * 0.6) * s);
      g.stroke();
    });
  });
  g.beginPath(); g.ellipse(0, -s * 0.16, s * 0.10, s * 0.17, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(0, s * 0.16, s * 0.13, s * 0.27, 0, 0, Math.PI * 2); g.fill();
  g.restore();
}

const EXPR = {
  calm: { lens: 1, asym: 0, glow: 1 },
  fury: { lens: 0.42, asym: 0, glow: 1.6 },
  narrow: { lens: 0.6, asym: 0, glow: 1.2 },
  shock: { lens: 1.35, asym: 0, glow: 1.4 },
  smirk: { lens: 0.85, asym: 0.4, glow: 1.1 },
};

export function createSuitLayer(tracker, rig, planeW, planeH) {
  const group = new THREE.Group();

  const videoTex = new THREE.CanvasTexture(tracker.canvas);
  videoTex.colorSpace = THREE.SRGBColorSpace;
  videoTex.minFilter = THREE.LinearFilter; videoTex.generateMipmaps = false;

  let maskTex = null;
  let maskVersion = -1;

  const uniforms = {
    uVideo: { value: videoTex },
    uMask: { value: null },
    uHasMask: { value: 0 },
    uTime: { value: 0 },
    uFaceC: { value: new THREE.Vector2(0.5, 0.42 * ASPECT) },
    uFaceR: { value: 0.16 },
    uFaceRoll: { value: 0 },
    uFaceOk: { value: 0 },
    uChest: { value: new THREE.Vector2(0.5, 0.75) },
    uChestS: { value: 0.11 },
    uPoseOk: { value: 0 },
    uSegs: { value: Array.from({ length: 10 }, () => new THREE.Vector4(0.5, 0.9, 0.5, 1.4)) },
    uSegCol: { value: new Array(10).fill(0) },
    uSegR: { value: new Array(10).fill(0.08) },
    uRim: { value: new THREE.Color(0x5a4bff) },
    uSuitMix: { value: 0 },
  };

  const personMat = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    transparent: true, depthTest: false, depthWrite: false,
  });
  const person = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), personMat);
  person.renderOrder = 10;
  group.add(person);

  // 2D overlay: lenses, chest spider, mouth shading — locked to your landmarks
  const oc = document.createElement('canvas');
  oc.width = CROP_W; oc.height = CROP_H;
  const og = oc.getContext('2d');
  const overlayTex = new THREE.CanvasTexture(oc);
  overlayTex.colorSpace = THREE.SRGBColorSpace;
  const overlay = new THREE.Mesh(
    new THREE.PlaneGeometry(planeW, planeH),
    new THREE.MeshBasicMaterial({ map: overlayTex, transparent: true, depthTest: false, depthWrite: false })
  );
  overlay.renderOrder = 11;
  group.add(overlay);

  const exprState = { lens: 1, asym: 0, glow: 1 };
  let suitOn = 0;

  function updateSegments() {
    const p = tracker.points.pose;
    uniforms.uPoseOk.value = p.ok;
    if (!p.lm) return;
    const L = p.lm;
    const P = (i) => [L[i].x, L[i].y * ASPECT];
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const ext = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    const sL = P(11), sR = P(12), hL = P(23), hR = P(24);
    const shoulderMid = mid(sL, sR), hipMid = mid(hL, hR);
    const sw = Math.max(0.05, Math.hypot(sL[0] - sR[0], sL[1] - sR[1]));
    const f = tracker.points.face;
    const chin = [f.chin.x, f.chin.y * ASPECT];
    const set = (i, a, b, col, r) => {
      uniforms.uSegs.value[i].set(a[0], a[1], b[0], b[1]);
      uniforms.uSegCol.value[i] = col;
      uniforms.uSegR.value[i] = r;
    };
    set(0, chin, shoulderMid, 0, sw * 0.22);              // neck
    set(1, shoulderMid, ext(shoulderMid, hipMid, 1.12), 4, sw * 0.64); // torso, blue flanks
    set(2, sL, P(13), 0, sw * 0.20);                      // upper arms
    set(3, P(13), ext(P(13), P(15), 1.38), 0, sw * 0.17); // forearms + gloves
    set(4, sR, P(14), 0, sw * 0.20);
    set(5, P(14), ext(P(14), P(16), 1.38), 0, sw * 0.17);
    set(6, hL, P(25), 1, sw * 0.26);                      // thighs
    set(7, P(25), ext(P(25), P(27), 1.30), 2, sw * 0.21); // shins -> boots
    set(8, hR, P(26), 1, sw * 0.26);
    set(9, P(26), ext(P(26), P(28), 1.30), 2, sw * 0.21);
    // chest web origin sits between the shoulders
    uniforms.uChest.value.set(shoulderMid[0], shoulderMid[1] + sw * 0.28);
    uniforms.uChestS.value = sw * 0.42;
  }

  function drawOverlay(t) {
    og.clearRect(0, 0, CROP_W, CROP_H);
    const f = tracker.points.face;
    if (f.ok > 0.15) {
      og.save();
      og.globalAlpha = Math.min(1, f.ok) * suitOn;
      const eyeDistPx = f.eyeDist * CROP_W;
      const size = eyeDistPx * 0.68;
      const angle = f.angle;
      const ca = Math.cos(angle), sa = Math.sin(angle);
      // mouth shading — the mask visibly dents and stretches as you talk
      const mx = f.mouth.x * CROP_W, my = f.mouth.y * CROP_H;
      const mw = Math.max(f.mouthW * CROP_W * 0.95, eyeDistPx * 0.5);
      const mh = f.mouthOpen * CROP_W * 1.25 + eyeDistPx * 0.12;
      const mAlpha = 0.14 + rig.jaw * 0.38;
      const mg = og.createRadialGradient(mx, my + mh * 0.2, 0, mx, my + mh * 0.2, mw);
      mg.addColorStop(0, `rgba(20,0,4,${mAlpha})`);
      mg.addColorStop(1, 'rgba(20,0,4,0)');
      og.fillStyle = mg;
      og.save();
      og.translate(mx, my + mh * 0.2); og.rotate(angle); og.scale(1, Math.max(0.35, (mh / mw) * 1.6));
      og.beginPath(); og.arc(0, 0, mw, 0, Math.PI * 2); og.fill();
      og.restore();
      // lenses ride slightly outward + above your real eyes
      const offOut = eyeDistPx * 0.14, offUp = eyeDistPx * 0.10;
      const exL = f.eyeL.x * CROP_W - ca * offOut + sa * offUp;
      const eyL = f.eyeL.y * CROP_H - sa * offOut - ca * offUp;
      const exR = f.eyeR.x * CROP_W + ca * offOut + sa * offUp;
      const eyR = f.eyeR.y * CROP_H + sa * offOut - ca * offUp;
      const sqL = exprState.lens * (1 + exprState.asym * 0.4) * (1 - rig.blinkL * 0.62) * (1 + rig.browUp * 0.18);
      const sqR = exprState.lens * (1 - exprState.asym * 0.4) * (1 - rig.blinkR * 0.62) * (1 + rig.browUp * 0.18);
      drawLens(og, exL, eyL, size, angle, -1, sqL, exprState.glow);
      drawLens(og, exR, eyR, size, angle, 1, sqR, exprState.glow);
      og.restore();
    }
    const p = tracker.points.pose;
    if (p.ok > 0.3 && p.lm) {
      og.save();
      og.globalAlpha = Math.min(1, p.ok) * suitOn * 0.95;
      const L = p.lm;
      const sx = ((L[11].x + L[12].x) / 2) * CROP_W, sy = ((L[11].y + L[12].y) / 2) * CROP_H;
      const hx = ((L[23].x + L[24].x) / 2) * CROP_W, hy = ((L[23].y + L[24].y) / 2) * CROP_H;
      const swPx = Math.hypot((L[11].x - L[12].x) * CROP_W, (L[11].y - L[12].y) * CROP_H);
      const cx = sx + (hx - sx) * 0.24, cy = sy + (hy - sy) * 0.24;
      const ang = Math.atan2(L[12].y - L[11].y, L[12].x - L[11].x);
      drawSpider(og, cx, cy, swPx * 0.30, ang);
      og.restore();
    }
    overlayTex.needsUpdate = true;
  }

  function update(t, dt) {
    const k = 1 - Math.exp(-dt * 10);
    videoTex.needsUpdate = true;
    uniforms.uTime.value = t;

    // suit fades in once tracking locks — no hard pop
    const locked = tracker.points.face.ok > 0.4 || tracker.points.pose.ok > 0.4;
    suitOn += ((locked ? 1 : 0) - suitOn) * k;
    uniforms.uSuitMix.value = suitOn;

    const f = tracker.points.face;
    uniforms.uFaceOk.value = f.ok;
    uniforms.uFaceC.value.set(f.center.x, f.center.y * ASPECT);
    uniforms.uFaceR.value = Math.max(0.04, f.eyeDist * 1.55);
    uniforms.uFaceRoll.value = -f.angle;
    updateSegments();

    // person matte
    const seg = tracker.points.seg;
    if (seg.data && seg.version !== maskVersion) {
      maskVersion = seg.version;
      if (!maskTex || maskTex.image.width !== seg.w || maskTex.image.height !== seg.h) {
        if (maskTex) maskTex.dispose();
        maskTex = new THREE.DataTexture(seg.data, seg.w, seg.h, THREE.RedFormat, THREE.FloatType);
        maskTex.minFilter = THREE.LinearFilter; maskTex.magFilter = THREE.LinearFilter;
        uniforms.uMask.value = maskTex;
        uniforms.uHasMask.value = 1;
      } else {
        maskTex.image.data = seg.data;
      }
      maskTex.needsUpdate = true;
    }

    // expression preset eases in
    const target = EXPR[rig.expression] || EXPR.calm;
    ['lens', 'asym', 'glow'].forEach((key) => { exprState[key] += (target[key] - exprState[key]) * k; });

    drawOverlay(t);
  }

  function setRim(hex) { uniforms.uRim.value.setHex(hex); }

  function dispose() {
    videoTex.dispose(); overlayTex.dispose();
    if (maskTex) maskTex.dispose();
    personMat.dispose();
    person.geometry.dispose(); overlay.geometry.dispose();
  }

  return { group, update, setRim, dispose };
}

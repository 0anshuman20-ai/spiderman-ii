/* The suit compositor — a true AR filter.
   Your real webcam pixels ARE the suit: a GPU shader recolors your body into the
   red/blue costume with black webbing while preserving your actual lighting, shadows,
   wrinkles and facial motion. When you open your mouth, the mask visibly moves,
   because it is literally your video. Landmark-locked white lenses and a chest
   spider are drawn on top. The AI person-matte cuts your room away so the 3D
   space world shows behind you.

   REALISM PASS (movie-suit grade):
   - Raised rubber webbing: embossed top-edge specular + groove ambient occlusion,
     organic line wobble so nothing reads as computer-drawn.
   - Per-limb web origins: webs radiate from the mask center, chest, shoulders,
     wrists and knees exactly like the screen-used costumes.
   - Red panels carry a hexagonal micro-texture (Raimi suit); blue panels carry a
     diagonal twill ballistic weave.
   - Filmic fabric response: shadows sink toward a dyed dark, highlights desaturate
     toward sheen white, midtones get a chroma push — no flat tinting.
   - Screen-space relighting: luma-gradient pseudo-normals add a key-light specular
     and world-colored rim wrap around your true silhouette.
   - Refined matte: multi-tap edge erode + feather kills halo and flicker. */
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

  const vec3 RED  = vec3(0.62, 0.052, 0.075);
  const vec3 BLUE = vec3(0.055, 0.105, 0.36);
  const vec2 KEY_DIR = vec2(-0.42, -0.82);   // key light falls from upper-left

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
               mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
  }

  /* normalized distance to the nearest web line (rings + radial spokes).
     0 = line center, 1 = line edge, >1 = open fabric. Lines get a hand-worn
     wobble so they never read as vector art. */
  float webDist(vec2 q, vec2 c, float roll, float spacing, float radial) {
    vec2 d = q - c;
    float cs = cos(roll), sn = sin(roll);
    d = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
    float r = length(d);
    float ang = atan(d.y, d.x);
    // organic wobble: rings breathe, spokes bend slightly
    r += (vnoise(vec2(ang * 2.2 + 7.0, r * 26.0)) - 0.5) * spacing * 0.22;
    float lw = spacing * 0.062;
    float ringD = abs(fract(r / spacing + 0.5) - 0.5) * spacing;
    float sector = 6.28318530 / radial;
    float angW = ang + (vnoise(vec2(r * 14.0, 3.3)) - 0.5) * 0.05;
    float arcD = abs(fract(angW / sector + 0.5) - 0.5) * sector * max(r, 1e-4);
    return min(ringD, arcD) / max(lw, 1e-5);
  }

  /* hexagonal micro-cell texture — the Raimi-suit raised hex weave */
  float hexCells(vec2 p) {
    vec2 h = vec2(1.0, 1.7320508);
    vec2 a = mod(p, h) - h * 0.5;
    vec2 b = mod(p + h * 0.5, h) - h * 0.5;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    return length(g); // 0 at cell center
  }

  void main() {
    vec2 pt = vec2(vUv.x, 1.0 - vUv.y);        // top-down, matches landmarks
    vec2 q = vec2(pt.x, pt.y * ${ASPECT.toFixed(5)});

    vec4 video = texture2D(uVideo, vUv);

    /* ---- refined person matte: erode + feather (kills halo + flicker) ---- */
    float alpha = 1.0;
    float m = 1.0;
    if (uHasMask > 0.5) {
      vec2 mUv = vec2(vUv.x, 1.0 - vUv.y);
      vec2 px = vec2(1.0 / 288.0, 1.0 / 512.0);
      float m0 = texture2D(uMask, mUv).r;
      float m1 = texture2D(uMask, mUv + vec2(px.x, 0.0)).r;
      float m2 = texture2D(uMask, mUv - vec2(px.x, 0.0)).r;
      float m3 = texture2D(uMask, mUv + vec2(0.0, px.y)).r;
      float m4 = texture2D(uMask, mUv - vec2(0.0, px.y)).r;
      float mAvg = (m0 + m1 + m2 + m3 + m4) * 0.2;
      m = mix(mAvg, min(m0, mAvg), 0.55);       // slight erode pulls the edge inward
      alpha = smoothstep(0.36, 0.60, m);
    }
    if (alpha < 0.004) discard;

    /* ---- region classification against the live skeleton ---- */
    float best = 1e9; float bid = 0.0; float bt = 0.0;
    vec2 bA = uChest; float bR = 0.1;
    for (int i = 0; i < 10; i++) {
      vec2 a = uSegs[i].xy, b = uSegs[i].zw;
      vec2 ba = b - a; vec2 pa = q - a;
      float tt = clamp(dot(pa, ba) / (dot(ba, ba) + 1e-6), 0.0, 1.0);
      float d = length(pa - ba * tt) / max(uSegR[i], 1e-4);
      if (d < best) { best = d; bid = uSegCol[i]; bt = tt; bA = a; bR = uSegR[i]; }
    }
    float dHead = length(q - uFaceC);
    bool isHead = uFaceOk > 0.3 && dHead < uFaceR * 2.05;
    if (isHead) bid = 3.0;
    if (uPoseOk < 0.3 && !isHead) { bid = 0.0; best = 0.5; }

    /* ---- base color + web distance field per region ---- */
    vec3 base;
    float wd = 99.0;       // web distance (0 = line center)
    float webSpacing = max(uChestS, 0.03) * 0.5;
    if (bid == 3.0 || isHead) {
      base = RED;
      float sp = max(uFaceR, 0.02) * 0.40;
      wd = webDist(q, uFaceC, uFaceRoll, sp, 16.0);
      webSpacing = sp;
      // fade webbing out right at the mask boundary
      float edge = smoothstep(2.05, 1.75, dHead / max(uFaceR, 1e-4));
      wd = mix(99.0, wd, edge);
    } else if (bid == 1.0) {
      base = BLUE;
    } else if (bid == 2.0) {
      base = mix(BLUE, RED, smoothstep(0.52, 0.70, bt)); // boots
      float sp = max(bR, 0.02) * 0.55;
      float bootMask = smoothstep(0.52, 0.72, bt);
      wd = mix(99.0, webDist(q, bA, 0.0, sp, 12.0), bootMask);
      webSpacing = sp;
    } else if (bid == 4.0) {
      base = mix(RED, BLUE, smoothstep(0.74, 0.97, best)); // blue flanks
      float torsoMask = 1.0 - smoothstep(0.70, 0.95, best);
      wd = mix(99.0, webDist(q, uChest, 0.0, webSpacing, 20.0), torsoMask);
    } else {
      base = RED;
      // limbs: webs radiate from their own joint (shoulder / wrist), like the suit
      float sp = max(bR, 0.02) * 0.62;
      wd = webDist(q, bA, 0.0, sp, 12.0);
      webSpacing = sp;
    }

    /* ---- raised rubber webbing: line + emboss + groove AO ---- */
    float line = 1.0 - smoothstep(0.45, 1.0, wd);                 // black web line
    float ao = (1.0 - smoothstep(0.9, 2.4, wd)) * 0.24;           // groove shadow
    float emboss = 0.0;
    if (wd < 3.0) {
      // re-evaluate the field a hair toward the key light: the lit top edge pops
      vec2 off = normalize(KEY_DIR) * webSpacing * 0.10;
      float wdL;
      if (bid == 3.0 || isHead) wdL = webDist(q + off, uFaceC, uFaceRoll, webSpacing, 16.0);
      else if (bid == 4.0)      wdL = webDist(q + off, uChest, 0.0, webSpacing, 20.0);
      else                      wdL = webDist(q + off, bA, 0.0, webSpacing, 12.0);
      emboss = clamp((wdL - wd) * 1.4, 0.0, 1.0) * (1.0 - smoothstep(1.2, 2.0, wd));
    }

    /* ---- fabric micro-structure ---- */
    float micro;
    if (bid == 1.0 || (bid == 2.0 && bt < 0.52)) {
      // blue: diagonal twill ballistic weave
      micro = sin((q.x + q.y) * 1350.0) * sin((q.x - q.y) * 1350.0) * 0.045;
    } else {
      // red: hexagonal raised cells
      float hd = hexCells(q * 780.0);
      micro = (smoothstep(0.18, 0.46, hd) - 0.5) * 0.075;
    }

    /* ---- dye mottle + wear: no real costume is one flat color ---- */
    float mottle = vnoise(q * 34.0) * 0.6 + vnoise(q * 9.0) * 0.4;  // large soft dye variation
    base *= 0.93 + mottle * 0.14;
    float scuff = smoothstep(0.72, 0.95, vnoise(q * 120.0 + 51.0)); // rare pale wear spots
    base = mix(base, base * 1.35 + vec3(0.04), scuff * 0.10);

    /* ---- screen-space relighting from YOUR real shading ---- */
    float luma = dot(video.rgb, vec3(0.299, 0.587, 0.114));
    vec2 texel = vec2(1.0 / 720.0, 1.0 / 1280.0);
    float lR = dot(texture2D(uVideo, vUv + vec2(texel.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float lU = dot(texture2D(uVideo, vUv + vec2(0.0, texel.y)).rgb, vec3(0.299, 0.587, 0.114));
    // denoised luma for tonality: 4-tap cross blur kills sensor-noise sparkle
    float lL = dot(texture2D(uVideo, vUv - vec2(texel.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float lD = dot(texture2D(uVideo, vUv - vec2(0.0, texel.y)).rgb, vec3(0.299, 0.587, 0.114));
    float sLuma = (luma * 2.0 + lR + lU + lL + lD) / 6.0;
    /* costume normalization: compress the camera's tonal range so shirt prints,
       logos, skin tone and fabric patterns can NOT read through the suit —
       only the broad light/shadow form of your body survives the recolor */
    sLuma = clamp(sLuma, 0.0, 1.0);
    sLuma = 0.5 + (sLuma - 0.5) * 0.60;                            // flatten real-clothing contrast
    sLuma = pow(sLuma, 0.92);                                      // lift the compressed mids
    vec2 grad = vec2(lR - lL, lU - lD) * 0.5;                      // pseudo surface normal
    float form = clamp(dot(normalize(grad + 1e-5), normalize(KEY_DIR)) * length(grad) * 30.0, -0.35, 0.5);

    // filmic fabric response: dyed-dark shadows, chroma-pushed mids, sheen highs
    float shade = 0.16 + 1.9 * pow(sLuma, 0.9);
    vec3 dyedDark = base * vec3(0.28, 0.22, 0.30);                 // shadows keep dye hue
    vec3 lit = base * shade;
    vec3 suit = mix(dyedDark, lit, smoothstep(0.22, 0.44, sLuma)); // thresholds match the compressed luma range
    suit *= 1.0 + micro + form * 0.6;                              // weave + recovered form
    suit += vec3(1.0, 0.88, 0.82) * pow(sLuma, 4.5) * 0.42;        // broad fabric sheen
    suit += vec3(1.0) * pow(max(form, 0.0), 1.5) * 0.35;           // key-light specular
    // dye chroma push: keeps the costume reading as saturated spandex, never
    // as tinted video of your real clothes
    float sg = dot(suit, vec3(0.299, 0.587, 0.114));
    suit = mix(vec3(sg), suit, 1.18);

    // webbing: near-black rubber, AO groove, lit top edge
    suit *= 1.0 - ao;
    vec3 rubber = vec3(0.016, 0.014, 0.02) * (0.6 + luma * 1.4);
    suit = mix(suit, rubber, clamp(line, 0.0, 1.0) * 0.96);
    suit += vec3(0.9, 0.85, 0.8) * emboss * (0.10 + luma * 0.30);  // embossed highlight

    vec3 col = mix(video.rgb, suit, uSuitMix);

    // world rim light wraps the silhouette (uses the eroded matte band)
    float rimB = smoothstep(0.36, 0.52, m) * (1.0 - smoothstep(0.52, 0.86, m));
    col += uRim * rimB * (0.55 + 0.18 * sin(uTime * 1.7));
    // faint world bounce fill in the darkest folds keeps blacks alive
    col += uRim * (1.0 - smoothstep(0.0, 0.22, luma)) * 0.05 * uSuitMix;

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
  g.lineJoin = 'round';

  // soft shadow bed so the rim reads as raised from the mask
  g.save();
  g.scale(1.42, 1.5);
  lensPath(g);
  const bed = g.createRadialGradient(0, 0.1, 0.2, 0, 0.1, 1.4);
  bed.addColorStop(0, 'rgba(0,0,0,0.55)');
  bed.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = bed; g.fill();
  g.restore();

  // thick black rubber rim with a faint top-edge sheen
  g.save(); g.scale(1.26, 1.32); lensPath(g); g.fillStyle = '#060609'; g.fill(); g.restore();
  g.save(); g.scale(1.24, 1.30); g.translate(-0.015, -0.02); lensPath(g);
  g.strokeStyle = 'rgba(120,120,140,0.35)'; g.lineWidth = 0.05; g.stroke(); g.restore();

  if (glow > 1.15) { g.shadowColor = 'rgba(255,255,255,0.8)'; g.shadowBlur = size * 0.45 * glow; }

  // white lens: bright key reflection top-left, cool ambient falloff bottom-right
  const gr = g.createLinearGradient(-0.9, -0.9, 0.75, 0.95);
  gr.addColorStop(0, '#ffffff');
  gr.addColorStop(0.45, '#f2f4fa');
  gr.addColorStop(0.8, '#cdd6e8');
  gr.addColorStop(1, '#aab6cf');
  lensPath(g);
  g.fillStyle = gr; g.fill();
  g.shadowBlur = 0;

  // environment reflection: soft blue-violet pool in the lower lens
  const env = g.createRadialGradient(0.25, 0.35, 0.05, 0.25, 0.35, 0.8);
  env.addColorStop(0, 'rgba(120,110,220,0.16)');
  env.addColorStop(1, 'rgba(120,110,220,0)');
  lensPath(g); g.fillStyle = env; g.fill();

  // crisp specular streak — the "wet lens" catchlight
  g.save();
  g.beginPath();
  g.ellipse(-0.34, -0.42, 0.34, 0.10, -0.5, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fill();
  g.beginPath();
  g.ellipse(0.30, 0.18, 0.10, 0.045, -0.4, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fill();
  g.restore();

  // thin inner frame line seats the lens into the rim
  lensPath(g);
  g.strokeStyle = 'rgba(10,10,16,0.65)';
  g.lineWidth = 0.055;
  g.stroke();

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
  // faint highlight along the abdomen so the emblem reads as embossed
  g.beginPath(); g.ellipse(-s * 0.03, s * 0.08, s * 0.035, s * 0.14, 0.1, 0, Math.PI * 2);
  g.fillStyle = 'rgba(120,120,140,0.28)'; g.fill();
  g.restore();
}

const EXPR = {
  calm: { lens: 1, asym: 0, glow: 1 },
  fury: { lens: 0.42, asym: 0, glow: 1.6 },
  narrow: { lens: 0.6, asym: 0, glow: 1.2 },
  shock: { lens: 1.18, asym: 0, glow: 1.4 },
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
      // screen-accurate lens proportion: on the film suits the lens spans roughly
      // half the interpupillary distance — big enough to read, never bug-eyed
      const size = eyeDistPx * 0.5;
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
      const offOut = eyeDistPx * 0.11, offUp = eyeDistPx * 0.08;
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

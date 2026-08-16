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
  uniform vec2 uMouthC;     // mouth center (aspect-corrected)
  uniform float uMouthW;    // mouth width (aspect-corrected)
  uniform float uMouthOpen; // lip separation (aspect-corrected)
  uniform float uJaw;       // fused jaw (blendshape + lip-gap geometry) 0..1
  uniform float uPucker;    // viseme: mouth rounds ("O"/"OO") 0..1
  uniform float uSmile;     // viseme: mouth widens ("E") 0..1
  uniform vec2 uChest;      // chest web origin
  uniform float uChestS;    // body web spacing
  uniform float uPoseOk;
  uniform vec4 uSegs[32];   // limb + hand segments a.xy -> b.xy
  uniform float uSegCol[32];// 0 red, 1 blue, 2 shin(blue->red boot), 4 torso, 5 glove palm, 6 finger
  uniform float uSegR[32];  // segment radius
  uniform vec3 uRim;        // world rim-light color
  uniform float uSuitMix;   // 0 raw video -> 1 full suit

  // classic screen-suit dye: a brighter true Spider-Man red (the old value
  // leaned maroon) and a royal blue with more light in it
  const vec3 RED  = vec3(0.72, 0.065, 0.085);
  const vec3 BLUE = vec3(0.075, 0.145, 0.46);
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

    /* ---- region classification against the live skeleton + hands ---- */
    float best = 1e9; float bid = 0.0; float bt = 0.0;
    vec2 bA = uChest; float bR = 0.1;
    for (int i = 0; i < 32; i++) {
      vec2 a = uSegs[i].xy, b = uSegs[i].zw;
      vec2 ba = b - a; vec2 pa = q - a;
      float tt = clamp(dot(pa, ba) / (dot(ba, ba) + 1e-6), 0.0, 1.0);
      float d = length(pa - ba * tt) / max(uSegR[i], 1e-4);
      // gloves win ties against the coarse forearm capsule so fingers stay crisp
      if (uSegCol[i] > 4.5) d *= 0.72;
      if (d < best) { best = d; bid = uSegCol[i]; bt = tt; bA = a; bR = uSegR[i]; }
    }
    /* head region: rolled ellipse that hugs the real skull — taller than wide,
       so the mask reads as a mask, not a red disc.
       IMPORTANT: the mask must swallow HAIR too. Landmarks only describe the face,
       so the capsule is grown upward (hair volume above the brow) and the overall
       radius is widened — any hair left outside gets recolored as background-side
       skin and instantly breaks the illusion. */
    vec2 hd2 = q - uFaceC;
    float hcs = cos(uFaceRoll), hsn = sin(uFaceRoll);
    hd2 = vec2(hd2.x * hcs - hd2.y * hsn, hd2.x * hsn + hd2.y * hcs);
    hd2.y /= 1.46;                                  // taller capsule: skull + hair mass
    hd2.y += uFaceR * 0.16;                         // bias downward to cover the jaw
    // asymmetric growth: extend well above the brow line so the hairline, fringe
    // and crown are all inside the mask region
    if (hd2.y < 0.0) hd2.y *= 0.74;                 // upper half reaches further for hair
    // jaw-driven chin extension: when the mouth opens the real chin drops, so the
    // mask capsule reaches further down — the fabric visibly follows the jaw
    if (hd2.y > 0.0) hd2.y /= (1.0 + uJaw * 0.16);
    hd2.x /= 1.03;                                  // slight width for ears/sideburns
    float dHead = length(hd2);
    bool isHead = uFaceOk > 0.3 && dHead < uFaceR * 1.86;
    if (isHead) bid = 3.0;
    if (uPoseOk < 0.3 && !isHead && bid < 4.5) { bid = 0.0; best = 0.5; }

    /* ---- base color + web distance field per region ---- */
    vec3 base;
    float wd = 99.0;       // web distance (0 = line center)
    float webSpacing = max(uChestS, 0.03) * 0.5;
    if (bid == 3.0 || isHead) {
      base = RED;
      // finer rings + more radial spokes = the classic comic/film mask web
      float sp = max(uFaceR, 0.02) * 0.32;
      /* LIP SYNC, fabric-style: as your jaw opens, the mask fabric over the
         mouth stretches. The web lines are printed ON that fabric, so they
         must spread apart around the opening — warp the sample point away
         from the mouth center before evaluating the web field. This is what
         a real spandex mask does when the wearer talks. */
      vec2 qm = q;
      if (uFaceOk > 0.3) {
        vec2 mv = q - uMouthC;
        float mrad = max(uMouthW, 0.02) * 2.3;
        float mfall = exp(-dot(mv, mv) / max(mrad * mrad * 0.5, 1e-6));
        // web lines VISIBLY spread apart over the talking mouth — pucker rounds
        // the spread field, smile widens it; hard-zero at rest via the jaw gate
        float gate = smoothstep(0.03, 0.12, uJaw);
        float stretch = clamp(uJaw * 0.85 + uMouthOpen * 2.6 + uPucker * 0.30, 0.0, 0.72) * gate;
        vec2 dir = normalize(mv + vec2(1e-5));
        dir.x *= 1.0 + uSmile * 0.5 - uPucker * 0.35; // viseme-shaped spread
        qm -= dir * mfall * stretch * max(uMouthW, 0.02) * 0.62;
      }
      wd = webDist(qm, uFaceC, uFaceRoll, sp, 24.0);
      webSpacing = sp;
      // fade webbing out right at the mask boundary (must match the 1.86 cutoff
      // used above, or a bare web-free ring appears around the edge of the mask)
      float edge = smoothstep(1.86, 1.58, dHead / max(uFaceR, 1e-4));
      wd = mix(99.0, wd, edge);
    } else if (bid == 5.0) {
      // glove back/palm: webbing radiates from the wrist exactly like the film suits
      base = RED;
      float sp = max(bR, 0.015) * 0.85;
      wd = webDist(q, bA, 0.0, sp, 10.0);
      webSpacing = sp;
    } else if (bid == 6.0) {
      // fingers: plain red spandex, no webbing — seams and shading come later
      base = RED;
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
      if (bid == 3.0 || isHead) wdL = webDist(q + off, uFaceC, uFaceRoll, webSpacing, 24.0);
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

    /* ---- tension wrinkles: fabric bunches at the ends of every limb capsule ---- */
    float wrinkle = 0.0;
    if (bid < 2.5 || bid > 4.5) {
      float endPinch = smoothstep(0.16, 0.0, bt) + smoothstep(0.84, 1.0, bt);
      float folds = sin(bt * 46.0 + vnoise(q * 60.0) * 6.0);
      wrinkle = endPinch * folds * 0.5;
      base *= 1.0 - max(0.0, -wrinkle) * 0.16;                      // fold shadow
    }

    /* ---- fingers/gloves: cylindrical rounding + stitched seams ---- */
    float cyl = 0.0;
    if (bid > 4.5) {
      cyl = smoothstep(0.45, 1.0, best);                            // edges curve away
      base *= 1.0 - cyl * 0.30;
      // center seam highlight running along each finger / the glove back
      float seam = smoothstep(0.10, 0.02, abs(best - 0.06));
      base = mix(base, base * 0.72, seam * 0.5 * step(5.5, bid));   // finger seam stitch line
      // knuckle micro-pads on the glove back
      if (bid == 5.0) {
        float kn = smoothstep(0.3, 0.05, hexCells(q * 420.0));
        base *= 1.0 + kn * 0.05;
      }
    }

    /* ---- screen-space relighting from YOUR real shading ---- */
    float luma = dot(video.rgb, vec3(0.299, 0.587, 0.114));
    vec2 texel = vec2(1.0 / 720.0, 1.0 / 1280.0);
    float lR = dot(texture2D(uVideo, vUv + vec2(texel.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float lU = dot(texture2D(uVideo, vUv + vec2(0.0, texel.y)).rgb, vec3(0.299, 0.587, 0.114));
    // denoised luma for tonality: 4-tap cross blur kills sensor-noise sparkle
    float lL = dot(texture2D(uVideo, vUv - vec2(texel.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float lD = dot(texture2D(uVideo, vUv - vec2(0.0, texel.y)).rgb, vec3(0.299, 0.587, 0.114));
    float sLuma = (luma * 2.0 + lR + lU + lL + lD) / 6.0;

    /* WIDE luma ring: captures only the broad light/shadow form of your body.
       On the HEAD the radius is much larger (22 texels): hair, eyebrows, eye
       sockets and beard are all high-frequency relative to this, so averaging
       over that span erases them and leaves only "a smooth head-shaped volume
       lit from somewhere" — exactly what a fabric mask looks like. */
    float wr = isHead ? 22.0 : 10.0;
    vec2 wtex = texel * wr;
    float w1 = dot(texture2D(uVideo, vUv + vec2( wtex.x,  0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float w2 = dot(texture2D(uVideo, vUv + vec2(-wtex.x,  0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float w3 = dot(texture2D(uVideo, vUv + vec2( 0.0,  wtex.y)).rgb, vec3(0.299, 0.587, 0.114));
    float w4 = dot(texture2D(uVideo, vUv + vec2( 0.0, -wtex.y)).rgb, vec3(0.299, 0.587, 0.114));
    float w5 = dot(texture2D(uVideo, vUv + wtex * 0.7).rgb, vec3(0.299, 0.587, 0.114));
    float w6 = dot(texture2D(uVideo, vUv - wtex * 0.7).rgb, vec3(0.299, 0.587, 0.114));
    // second, even wider ring on the head kills the dark-hair / light-skin step
    float w7 = sLuma, w8 = sLuma;
    if (isHead) {
      vec2 w2tex = texel * 40.0;
      w7 = dot(texture2D(uVideo, vUv + w2tex * vec2(0.9, 0.6)).rgb, vec3(0.299, 0.587, 0.114));
      w8 = dot(texture2D(uVideo, vUv - w2tex * vec2(0.9, 0.6)).rgb, vec3(0.299, 0.587, 0.114));
    }
    float wLuma = (w1 + w2 + w3 + w4 + w5 + w6 + w7 + w8) * 0.125;

    /* detail firewall: base tonality comes from the WIDE blur (pure body form);
       only a whisper of fine luma survives, and it is soft-clipped so a bold
       logo edge cannot punch through the dye */
    float fine = clamp(sLuma - wLuma, -0.5, 0.5);
    fine = fine / (1.0 + 6.0 * abs(fine));                         // soft-knee compressor
    /* Body detail is cut hard (0.14) so a shirt collar, print or logo edge stays
       invisible while muscle/fold form still survives. (The head ignores this
       entirely — see the synthetic mask shading below.) */
    sLuma = wLuma + fine * 0.09;

    /* costume normalization: compress the camera's tonal range so nothing of
       your real clothing contrast survives the recolor. The head is flattened
       hardest and re-centered, so a pale face and dark hair collapse to the
       SAME even fabric tone. */
    sLuma = clamp(sLuma, 0.0, 1.0);
    sLuma = 0.5 + (sLuma - 0.5) * 0.42;                            // flatten real-clothing contrast
    sLuma = pow(sLuma, 0.92);                                      // lift the compressed mids
    vec2 grad = vec2(lR - lL, lU - lD) * 0.5;                      // pseudo surface normal
    /* widen the pseudo-normal so broad muscle form — never a logo edge, hairline
       or eye socket — drives the relight. */
    grad = mix(grad, vec2(w1 - w2, w3 - w4) * 0.5, 0.82);
    float form = clamp(dot(normalize(grad + 1e-5), normalize(KEY_DIR)) * length(grad) * 30.0, -0.35, 0.5);

    /* ================= MASK SHADING IS SYNTHETIC =================
       Definitive concealment: on the head we throw the video signal away
       ENTIRELY and shade from head GEOMETRY instead. A real mask's shading is
       a function of skull shape and where the light is — it carries no
       information about the face underneath. Because no facial pixel reaches
       this path, eyebrows, eye sockets, nose, lips, stubble, skin tone and
       hair are mathematically incapable of showing through. Only the overall
       room brightness is sampled, so the mask still responds to your lighting. */
    if (isHead) {
      vec2 nx = hd2 / max(uFaceR * 1.86, 1e-4);                    // -1..1 across the capsule
      float r2 = clamp(dot(nx, nx), 0.0, 1.0);
      vec3 hn = vec3(nx, sqrt(1.0 - r2));                          // dome normal over the head
      vec3 L = normalize(vec3(normalize(KEY_DIR), 0.9));
      float lam = clamp(dot(hn, L), 0.0, 1.0);                     // smooth lambert falloff
      float wrap = clamp(dot(hn, L) * 0.5 + 0.5, 0.0, 1.0);        // soft wrap keeps edges alive
      // ambient: room light level only (a single very broad average, no detail)
      float amb = clamp((wLuma - 0.5) * 0.30, -0.18, 0.18);
      /* TONALLY MATCHED TO THE BODY: the old head shading floated ~15% brighter
         than the body's compressed-luma range, so the mask read as a lighter,
         detached balloon. This curve centers on the same mids the body uses. */
      sLuma = clamp(0.24 + lam * 0.34 + wrap * 0.12 + amb, 0.0, 1.0);
      form = clamp(lam * 0.45 - 0.10, -0.35, 0.5);                 // specular from geometry

      /* ============ SYNTHETIC FABRIC MOUTH (viseme-aware) ============
         A real spandex mask over a talking mouth is pure geometry: the jaw
         drops the fabric into a shadowed cavity, the stretched upper lip
         catches the key light as a ridge, the chin pushes a lit bulge below,
         and tension creases dimple the corners. Every term below is gated by
         live articulation, so the mask is perfectly clean at rest — no
         painted-on lips, ever — and fully alive the instant you speak. */
      if (uFaceOk > 0.3) {
        vec2 md = q - uMouthC;
        // rotate into head space so the mouth stays glued during head tilt
        md = vec2(md.x * hcs - md.y * hsn, md.x * hsn + md.y * hcs);
        float mw = max(uMouthW, 0.015);
        // activity gates — smoothstep deadbands mean HARD ZERO at rest
        float openA = smoothstep(0.035, 0.12, uJaw) * clamp(uJaw * 1.35 + uMouthOpen * 4.5, 0.0, 1.0);
        float puck  = smoothstep(0.12, 0.40, uPucker);
        float sml   = smoothstep(0.14, 0.48, uSmile);
        float act   = max(openA, max(puck * 0.55, sml * 0.45));
        if (act > 0.004) {
          /* viseme-shaped cavity: rounds when you say "O" (pucker narrows width,
             adds height), widens on "E" (smile), opens tall on "A" (jaw) */
          float wS = 1.30 * (1.0 - puck * 0.42) * (1.0 + sml * 0.50);
          float hS = (0.48 + openA * 1.20) * (1.0 + puck * 0.38);
          vec2 mc = vec2(md.x / (mw * wS), (md.y - mw * 0.20 * openA) / (mw * hS));
          float cav = exp(-dot(mc, mc) * 2.0) * openA;
          sLuma -= cav * 0.15;                        // shadowed fabric cavity
          form  -= cav * 0.10;                        // cavity goes matte in the light
          // stretched-fabric upper-lip highlight: a ridge just above the cavity
          vec2 ul = vec2(md.x / (mw * (1.10 + sml * 0.40)), (md.y + mw * (0.26 + openA * 0.20)) / (mw * 0.17));
          float ridge = exp(-dot(ul, ul) * 2.3) * act;
          sLuma += ridge * 0.09;
          form  += ridge * 0.07;
          // chin bulge: the jaw pushes fabric outward below the cavity
          vec2 cb = vec2(md.x / (mw * 1.05), (md.y - mw * (0.85 + openA * 0.55)) / (mw * 0.55));
          float bulge = exp(-dot(cb, cb) * 1.8) * openA;
          sLuma += bulge * 0.06;
          form  += bulge * 0.04;
          // tension creases: soft dimples at both mouth corners
          vec2 coL = vec2((md.x + mw * (0.60 + sml * 0.32)) / (mw * 0.22), md.y / (mw * 0.34));
          vec2 coR = vec2((md.x - mw * (0.60 + sml * 0.32)) / (mw * 0.22), md.y / (mw * 0.34));
          float dimp = (exp(-dot(coL, coL) * 1.6) + exp(-dot(coR, coR) * 1.6)) * max(act, sml);
          sLuma -= dimp * 0.05;
          sLuma = clamp(sLuma, 0.0, 1.0);
        }
      }
    }

    // filmic fabric response: dyed-dark shadows, chroma-pushed mids, sheen highs
    float shade = 0.16 + 1.9 * pow(sLuma, 0.9);
    vec3 dyedDark = base * vec3(0.28, 0.22, 0.30);                 // shadows keep dye hue
    vec3 lit = base * shade;
    vec3 suit = mix(dyedDark, lit, smoothstep(0.22, 0.44, sLuma)); // thresholds match the compressed luma range
    suit *= 1.0 + micro + form * 0.6;                              // weave + recovered form
    suit *= 1.0 + max(0.0, wrinkle) * 0.14;                        // lit tops of tension folds
    // fingers get a bright cylindrical core highlight — reads as tight spandex over skin
    if (bid > 5.5) suit += vec3(0.9, 0.5, 0.45) * pow(1.0 - best, 3.0) * 0.16;
    suit += vec3(1.0, 0.88, 0.82) * pow(sLuma, 4.5) * 0.42;        // broad fabric sheen
    suit += vec3(1.0) * pow(max(form, 0.0), 1.5) * 0.35;           // key-light specular
    // dye chroma push: keeps the costume reading as saturated spandex, never
    // as tinted video of your real clothes
    float sg = dot(suit, vec3(0.299, 0.587, 0.114));
    suit = mix(vec3(sg), suit, 1.18);

    // webbing: near-black rubber, AO groove, lit top edge.
    // driven by the FILTERED luma, never raw video — raw luma would let dark hair
    // and bright skin print themselves into the web lines.
    suit *= 1.0 - ao;
    vec3 rubber = vec3(0.016, 0.014, 0.02) * (0.6 + sLuma * 1.4);
    suit = mix(suit, rubber, clamp(line, 0.0, 1.0) * 0.96);
    suit += vec3(0.9, 0.85, 0.8) * emboss * (0.10 + sLuma * 0.30); // embossed highlight

    vec3 col = mix(video.rgb, suit, uSuitMix);

    // world rim light wraps the silhouette (uses the eroded matte band)
    float rimB = smoothstep(0.36, 0.52, m) * (1.0 - smoothstep(0.52, 0.86, m));
    col += uRim * rimB * (0.55 + 0.18 * sin(uTime * 1.7));
    // faint world bounce fill in the darkest folds keeps blacks alive
    col += uRim * (1.0 - smoothstep(0.0, 0.22, sLuma)) * 0.05 * uSuitMix;

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

  // gunmetal mechanical frame seated between rubber and lens (film-suit hardware)
  g.save(); g.scale(1.10, 1.14); lensPath(g);
  const fr = g.createLinearGradient(-0.8, -0.9, 0.7, 0.9);
  fr.addColorStop(0, '#565e70');
  fr.addColorStop(0.4, '#22262f');
  fr.addColorStop(0.75, '#3a4150');
  fr.addColorStop(1, '#14171d');
  g.strokeStyle = fr; g.lineWidth = 0.11; g.stroke();
  // tiny frame screws catch the light
  g.fillStyle = 'rgba(200,205,220,0.5)';
  [[-0.82, -0.1], [0.5, -0.62], [0.62, 0.42]].forEach(([sx, sy]) => {
    g.beginPath(); g.arc(sx, sy, 0.035, 0, Math.PI * 2); g.fill();
  });
  g.restore();

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

/* EXPRESSION → LENS: ONE IMMUTABLE SHAPE. Earlier passes only "toned down"
   the per-expression lens scaling (fury 0.88, shock 1.06, ...) — but script
   beats auto-switch expressions mid-take, so the eyes still visibly resized
   every few seconds. A real screen-suit lens is a rigid piece of hardware:
   its geometry NEVER changes. Every entry is exactly 1 — emotion lives ONLY
   in the GLOW, which can swing freely without touching a single vertex. */
  const EXPR = {
    calm: { lens: 1, asym: 0, glow: 1 },
    fury: { lens: 1, asym: 0, glow: 1.6 },
    narrow: { lens: 1, asym: 0, glow: 1.2 },
    shock: { lens: 1, asym: 0, glow: 1.4 },
    smirk: { lens: 1, asym: 0, glow: 1.1 },
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
    uMouthC: { value: new THREE.Vector2(0.5, 0.5 * ASPECT) },
    uMouthW: { value: 0.05 },
    uMouthOpen: { value: 0 },
    uJaw: { value: 0 },
    uPucker: { value: 0 },
    uSmile: { value: 0 },
    uChest: { value: new THREE.Vector2(0.5, 0.75) },
    uChestS: { value: 0.11 },
    uPoseOk: { value: 0 },
    uSegs: { value: Array.from({ length: 32 }, () => new THREE.Vector4(-9, -9, -9, -9)) },
    uSegCol: { value: new Array(32).fill(0) },
    uSegR: { value: new Array(32).fill(0.0001) },
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
  /* ONE-EURO FILTER — the industry-standard filter for AR face anchors.
     The old pipeline stacked TWO fixed EMAs (tracker kPos + a 0.4 lens EMA):
     smooth when still, but during a fast head whip the lenses trailed the
     face by many pixels. One-Euro is speed-adaptive — the cutoff opens with
     velocity, so it is glassy-still at rest AND essentially lag-free in
     motion. Each filter also exposes its velocity for a capped one-frame
     lead that cancels the remaining detect→draw pipeline latency. */
  function makeOneEuro(minCutoff, beta, dCutoff = 1.0) {
    let x = null, dx = 0;
    const alpha = (cutoff, dt) => { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); };
    return {
      filter(v, dt) {
        if (x == null || !(dt > 0)) { x = v; dx = 0; return v; }
        const rate = (v - x) / dt;
        dx += (rate - dx) * alpha(dCutoff, dt);
        const cutoff = minCutoff + beta * Math.abs(dx);
        x += (v - x) * alpha(cutoff, dt);
        return x;
      },
      get velocity() { return dx; },
    };
  }
  /* SKULL-FRAME anchoring: instead of filtering four eye coordinates
     independently (which can drift asymmetric), the lens transform is
     decomposed into the rigid-skull quantities — seam midpoint, half-span,
     roll, size — filtered individually, then the two lenses are
     RECONSTRUCTED perfectly mirrored around the seam. Eyelid/expression
     wobble on one corner can only nudge span/roll by half, never break
     the mirror. */
  const euro = {
    midX: makeOneEuro(1.1, 0.02), midY: makeOneEuro(1.1, 0.02),
    span: makeOneEuro(0.9, 0.015),
    size: makeOneEuro(0.7, 0.01),
    angle: makeOneEuro(1.0, 0.5),
  };
  let lastAngle = 0; // for wrap-safe angle filtering
  let suitOn = 0;
  let graceT = 0;          // hold timer that survives tracking dropouts
  let everLocked = false;  // once true, the suit never reveals raw video again
  let jawAnim = 0;         // eased mask jaw — audio-authoritative during script takes

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
    /* EXACT classic suit arms: RED shoulder -> BLUE mid-arm -> RED glove.
       The old all-red arms read as the wrong costume. Col 2 is a blue->red
       gradient along the capsule, so the upper arm is stored elbow->shoulder
       (red lands on the shoulder, with its webbing) and the forearm is stored
       elbow->wrist (red melts into the glove, webbing included). */
    set(2, P(13), sL, 2, sw * 0.20);                      // elbow -> shoulder: blue -> red
    set(3, P(13), ext(P(13), P(15), 1.38), 2, sw * 0.17); // elbow -> glove: blue -> red
    set(4, P(14), sR, 2, sw * 0.20);
    set(5, P(14), ext(P(14), P(16), 1.38), 2, sw * 0.17);
    set(6, hL, P(25), 1, sw * 0.26);                      // thighs
    set(7, P(25), ext(P(25), P(27), 1.30), 2, sw * 0.21); // shins -> boots
    set(8, hR, P(26), 1, sw * 0.26);
    set(9, P(26), ext(P(26), P(28), 1.30), 2, sw * 0.21);
    // chest web origin sits between the shoulders
    uniforms.uChest.value.set(shoulderMid[0], shoulderMid[1] + sw * 0.28);
    uniforms.uChestS.value = sw * 0.42;
  }

  /* real gloves: 11 capsules per hand (palm, thumb x2, four fingers x2 each)
     land in shader slots 10..31, glued to the HandLandmarker skeleton */
  function updateHands() {
    const hands = tracker.points.hands;
    const set = (i, ax, ay, bx, by, col, r) => {
      uniforms.uSegs.value[i].set(ax, ay, bx, by);
      uniforms.uSegCol.value[i] = col;
      uniforms.uSegR.value[i] = r;
    };
    for (let h = 0; h < 2; h++) {
      const baseI = 10 + h * 11;
      const slot = hands && hands.list[h];
      if (!slot || slot.ok < 0.35 || !slot.lm) {
        for (let i = 0; i < 11; i++) set(baseI + i, -9, -9, -9, -9, 0, 0.0001);
        continue;
      }
      const L = slot.lm;
      const P = (i) => [L[i].x, L[i].y * ASPECT];
      const wrist = P(0), midMcp = P(9);
      const handLen = Math.max(0.02, Math.hypot(midMcp[0] - wrist[0], midMcp[1] - wrist[1]));
      const fingerR = handLen * 0.19;
      // palm: wrist -> middle MCP, wide — carries the wrist-web origin
      set(baseI, wrist[0], wrist[1], midMcp[0], midMcp[1], 5, handLen * 0.62);
      // thumb: two capsules so a bent thumb stays covered
      const t2 = P(2), t3 = P(3), t4 = P(4);
      set(baseI + 1, t2[0], t2[1], t3[0], t3[1], 6, fingerR * 1.15);
      set(baseI + 2, t3[0], t3[1], t4[0], t4[1], 6, fingerR * 1.05);
      // four fingers: MCP -> PIP, PIP -> TIP (two capsules each survives a fist)
      const fingers = [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]];
      fingers.forEach(([mcp, pip, tip], fi) => {
        const a = P(mcp), b = P(pip), c = P(tip);
        set(baseI + 3 + fi * 2, a[0], a[1], b[0], b[1], 6, fingerR);
        set(baseI + 4 + fi * 2, b[0], b[1], c[0], c[1], 6, fingerR * 0.92);
      });
    }
  }

  function drawOverlay(t, dt) {
    og.clearRect(0, 0, CROP_W, CROP_H);
    const f = tracker.points.face;
    if (f.ok > 0.15) {
      og.save();
      og.globalAlpha = Math.min(1, f.ok) * suitOn;
      const eyeDistPx = f.eyeDist * CROP_W;
      // film-suit lens proportion: the big expressive teardrop is what makes the
      // mask instantly read as Spider-Man — slightly larger than half the
      // interpupillary distance, like the screen-used suits.
      // YAW COMPENSATION: a head turn foreshortens the eye distance but your
      // head is no further from the camera — divide out cos(yaw) so the lenses
      // hold their true size through every head turn.
      const yawC = Math.max(0.55, Math.abs(Math.cos(rig.headYaw)));
      // 0.52: the screen-suit proportion without swallowing the temples — the
      // old 0.58 read slightly bug-eyed at close camera distance
      const size = (eyeDistPx / yawC) * 0.52;
      const angle = f.angle;
      /* ---- mask center seam: forehead over the nose bridge to the chin ---- */
      const fhx = f.forehead.x * CROP_W, fhy = f.forehead.y * CROP_H;
      const chx = f.chin.x * CROP_W, chy = f.chin.y * CROP_H;
      const ncx = f.center.x * CROP_W, ncy = f.center.y * CROP_H;
      og.save();
      og.globalAlpha = 0.16 * Math.min(1, f.ok) * suitOn;
      og.strokeStyle = 'rgba(10,2,6,1)';
      og.lineWidth = Math.max(1, eyeDistPx * 0.022);
      og.beginPath();
      og.moveTo(fhx, fhy - eyeDistPx * 0.55);
      og.quadraticCurveTo(ncx, ncy, chx, chy + eyeDistPx * 0.18);
      og.stroke();
      // seam catch-light one thread to the side — sells it as a raised stitch
      og.globalAlpha = 0.09 * Math.min(1, f.ok) * suitOn;
      og.strokeStyle = 'rgba(255,220,210,1)';
      og.beginPath();
      og.moveTo(fhx + og.lineWidth, fhy - eyeDistPx * 0.55);
      og.quadraticCurveTo(ncx + og.lineWidth, ncy, chx + og.lineWidth, chy + eyeDistPx * 0.18);
      og.stroke();
      og.restore();

      /* ---- mouth: the SHADER owns the mouth now. The synthetic fabric-mouth
         model (cavity, upper-lip ridge, chin bulge, corner dimples) is painted
         in the recolor pass itself — a second canvas shadow here would double
         up and read as a smudge, so the overlay draws nothing over the mouth. */

      /* NO brow strokes: a real Spider-Man mask has no eyebrows — and NO
         expression/blink/brow term ever touches the lens geometry. The lens
         is rigid hardware: one shape, one aspect, forever. */
      /* SKULL-FRAME DECOMPOSITION: raw eye anchors collapse into midpoint +
         half-span + roll + size; each scalar runs through its own One-Euro
         filter; the two lenses are reconstructed perfectly mirrored. */
      const exL = f.eyeL.x * CROP_W, eyL = f.eyeL.y * CROP_H;
      const exR = f.eyeR.x * CROP_W, eyR = f.eyeR.y * CROP_H;
      const fdt = Math.max(0.001, Math.min(0.1, dt || 0.016));
      // capped one-frame velocity lead cancels detect→draw pipeline latency
      const LEAD = Math.min(fdt, 1 / 30);
      const fMidX = euro.midX.filter((exL + exR) / 2, fdt) + euro.midX.velocity * LEAD;
      const fMidY = euro.midY.filter((eyL + eyR) / 2, fdt) + euro.midY.velocity * LEAD;
      const fSpan = euro.span.filter(Math.hypot(exR - exL, eyR - eyL) / 2, fdt);
      const fSize = euro.size.filter(size, fdt);
      // wrap-safe roll: unwrap the raw angle against the last filtered value
      let aIn = angle;
      while (aIn - lastAngle > Math.PI) aIn -= Math.PI * 2;
      while (aIn - lastAngle < -Math.PI) aIn += Math.PI * 2;
      const fAngle = euro.angle.filter(aIn, fdt);
      lastAngle = fAngle;
      const fca = Math.cos(fAngle), fsa = Math.sin(fAngle);
      // lenses ride slightly outward + above your real eyes (filtered frame)
      const offOut = eyeDistPx * 0.11, offUp = eyeDistPx * 0.08;
      const lx = fMidX - fca * (fSpan + offOut) + fsa * offUp;
      const ly = fMidY - fsa * (fSpan + offOut) - fca * offUp;
      const rx = fMidX + fca * (fSpan + offOut) + fsa * offUp;
      const ry = fMidY + fsa * (fSpan + offOut) - fca * offUp;
      /* squash is CONSTANT 1: blinking, brow raises and expression beats can
         change the glow, never the geometry — like the films' rigid lenses. */
      drawLens(og, lx, ly, fSize, fAngle, -1, 1, exprState.glow);
      drawLens(og, rx, ry, fSize, fAngle, 1, 1, exprState.glow);
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

    /* suit fades in once tracking locks — no hard pop.
       IDENTITY SAFETY: tracking flickers constantly (head turns, motion blur, a
       hand crossing the face). A symmetric fade would race back toward raw video
       and expose the real face within a few frames, so the release is deliberately
       asymmetric: fast attack, and after the first lock the mix NEVER falls below
       a high floor. A briefly stale suit is always better than a visible face. */
    const locked = tracker.points.face.ok > 0.4 || tracker.points.pose.ok > 0.4;
    if (locked) graceT = 1.4;                       // seconds of hold after a dropout
    else graceT = Math.max(0, graceT - dt);
    const mixTarget = (locked || graceT > 0) ? 1 : 0.97;
    const mixRate = mixTarget > suitOn ? k : 1 - Math.exp(-dt * 0.7);  // slow release
    suitOn += (mixTarget - suitOn) * mixRate;
    /* DEFINITIVE: after first lock the mix is pinned at 100%. Even a 10%
       video bleed lets skin tone and clothing ghost through the dye — so
       once you are Spider-Man, you are COMPLETELY Spider-Man. */
    if (everLocked) suitOn = Math.max(suitOn, 1.0);
    if (locked) everLocked = true;
    uniforms.uSuitMix.value = suitOn;

    /* Only trust fresh landmarks. When the face detector blinks out we KEEP the
       last good position, radius and roll, and keep reporting the region as valid
       for the grace window — otherwise the mask would vanish mid-sentence and
       uncover the real face for exactly as long as the dropout lasts. */
    const f = tracker.points.face;
    if (f.ok > 0.4) {
      uniforms.uFaceC.value.set(f.center.x, f.center.y * ASPECT);
      // 1.40: hugs the real skull — the old 1.55 ballooned the head wider than
      // the shoulders and made the mask read as oversized
      uniforms.uFaceR.value = Math.max(0.04, f.eyeDist * 1.40);
      uniforms.uFaceRoll.value = -f.angle;
      uniforms.uFaceOk.value = f.ok;
      // live mouth geometry: drives the mask's visible lip-sync articulation
      uniforms.uMouthC.value.set(f.mouth.x, f.mouth.y * ASPECT);
      uniforms.uMouthW.value = Math.max(0.02, f.mouthW * 0.85);
      uniforms.uMouthOpen.value = f.mouthOpen;
      /* TRUE LIP SYNC — the AUDIO is the single source of truth.
         During a script take (rig.voiceActive) your real jaw is only the
         TRIGGER that fires a line; it must never drive the visible mouth,
         because human timing is imperfect: if your lips keep moving after
         the line's audio ends, the mask would silently flap. So:
           line playing (buffered) -> mouth follows the audio's syllables;
           line over               -> mouth SHUTS, even if your lips move;
           browser-voice fallback  -> audio isn't in the chain, follow lips;
           no script loaded        -> classic behavior, your jaw owns it. */
      const audioJaw = Math.min(1, (rig.level || 0) * 1.1);
      let jawTarget;
      if (rig.voiceActive) {
        if (rig.voicePlaying) jawTarget = rig.voiceBuffered ? audioJaw : rig.jaw;
        else jawTarget = 0;
      } else {
        jawTarget = Math.max(rig.jaw, audioJaw * 0.8);
      }
      // fast attack so no syllable is missed; the release is quick but eased
      // so the mouth closes cleanly (~80ms) instead of snapping shut
      jawAnim += (jawTarget - jawAnim) * (jawTarget > jawAnim ? 0.75 : 1 - Math.exp(-dt * 24));
      if (jawAnim < 0.01) jawAnim = 0;
      uniforms.uJaw.value = jawAnim;
      uniforms.uPucker.value = rig.pucker;
      uniforms.uSmile.value = rig.smile;
    } else if (graceT > 0 && everLocked) {
      uniforms.uFaceOk.value = 1;                   // hold the mask in its last pose
    } else {
      uniforms.uFaceOk.value = f.ok;
    }
    updateSegments();
    updateHands();

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

    drawOverlay(t, dt);
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

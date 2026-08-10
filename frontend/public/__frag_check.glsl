
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
    vec2 q = vec2(pt.x, pt.y * 1.77778);

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

    /* ---- screen-space relighting from YOUR real shading ---- */
    float luma = dot(video.rgb, vec3(0.299, 0.587, 0.114));
    vec2 texel = vec2(1.0 / 720.0, 1.0 / 1280.0);
    float lR = dot(texture2D(uVideo, vUv + vec2(texel.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float lU = dot(texture2D(uVideo, vUv + vec2(0.0, texel.y)).rgb, vec3(0.299, 0.587, 0.114));
    vec2 grad = vec2(lR - luma, lU - luma);                        // pseudo surface normal
    float form = clamp(dot(normalize(grad + 1e-5), normalize(KEY_DIR)) * length(grad) * 30.0, -0.35, 0.5);

    // filmic fabric response: dyed-dark shadows, chroma-pushed mids, sheen highs
    float shade = 0.16 + 1.9 * pow(luma, 0.9);
    vec3 dyedDark = base * vec3(0.28, 0.22, 0.30);                 // shadows keep dye hue
    vec3 lit = base * shade;
    vec3 suit = mix(dyedDark, lit, smoothstep(0.02, 0.30, luma));
    suit *= 1.0 + micro + form * 0.6;                              // weave + recovered form
    suit += vec3(1.0, 0.88, 0.82) * pow(luma, 4.5) * 0.42;         // broad fabric sheen
    suit += vec3(1.0) * pow(max(form, 0.0), 1.5) * 0.35;           // key-light specular

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

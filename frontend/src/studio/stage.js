/* Stage: 1080x1920 AR-filter pipeline.
   Background = live 3D space world with parallax that follows your real head position.
   Foreground = your actual webcam pixels, suited up by the GPU compositor, matted
   out of your room by AI segmentation. Filmic grade + bloom, no CRT gimmicks —
   it should read as footage, not a screensaver. */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createSuitLayer } from './suit';
import { createActor } from './actor';
import { FACE, FACE_CH } from './perf';
import { buildWorld } from './worlds';
import { createHandheld } from './handheld';

const W = 1080, H = 1920;

// rim-light color the suit picks up from each world
const WORLD_RIM = {
  'nebula-drift': 0x7a5aff,
  'red-planet': 0xff8844,
  'derelict-station': 0x55ccff,
  'asteroid-earth': 0x6699ff,
  'dying-star': 0xff6a33,
};

/* subtle filmic grade: vignette, fine grain, hair of chromatic aberration, glitch bursts */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGlitch: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uGlitch;
    varying vec2 vUv;
    float rand(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      if (uGlitch > 0.01) {
        float band = step(0.93, rand(vec2(floor(uv.y * 48.0), floor(uTime * 30.0))));
        uv.x += band * (rand(vec2(uTime, uv.y)) - 0.5) * 0.10 * uGlitch;
      }
      float ca = 0.0007 + uGlitch * 0.006;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + vec2(ca, 0.0)).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - vec2(ca, 0.0)).b;
      col += (rand(uv * (uTime + 1.0)) - 0.5) * 0.011;       // fine grain
      float d = distance(uv, vec2(0.5, 0.48));
      col *= 1.0 - d * d * 0.42;                              // gentle vignette
      col *= 1.0 - uGlitch * 0.12;
      /* HORROR GRADE — the genre is "wrong space", not "pretty space":
         crushed blacks, cooled shadows, one warm accent held for highlights */
      col = max(vec3(0.0), col - 0.014) * 1.05;               // crush blacks
      float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float sh = 1.0 - smoothstep(0.0, 0.42, L);
      col += vec3(-0.012, -0.004, 0.020) * sh;                // cool the shadows
      col += vec3(0.024, 0.011, -0.012) * smoothstep(0.62, 1.0, L); // warm accent
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createStage(canvas) {
  /* RECOVERY 1.2 #1 (verified specific) — logarithmic depth: planetary-scale
     worlds put a 4-unit sun and a 200-unit nebula dome in one frustum; a linear
     z-buffer wastes its precision on the first metre and shimmers/z-fights the
     far bodies, which reads as "game engine". Log depth spends precision where
     the scene actually is. */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
  renderer.setSize(W, H, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, W / H, 0.1, 200);
  const baseCam = new THREE.Vector3(0, 1.18, 3.5);
  const handheld = createHandheld(5);
  camera.position.copy(baseCam);
  scene.add(camera);

  /* THE DOOR's camera channel (RECOVERY v3 §2 / Phase A) — offsets the door
     engine (studio/door.js) writes and the loop applies AFTER the handheld
     solve, so the humanization noise survives the door pose. exposure rides
     the tone mapper (DIM_WORLD animates the world's light through the door). */
  const BASE_EXPOSURE = 1.18;
  const doorCam = { active: false, dolly: 0, yaw: 0, pitch: 0, roll: 0, fov: 0, exposure: 1 };

  /* ACTOR VISIBILITY — stored flag, applied at layer CREATION inside start()
     (layers are lazy: an early-armed door must not leak the character into
     frame zero) and on every later toggle. */
  let actorVisible = true;
  function applyActorVisible() {
    if (suitLayer) suitLayer.group.visible = actorVisible;
    simRoot.visible = actorVisible;
  }

  let worldParams = null; // WORLD EDITOR overrides {hueShift, density, motion}
  let world = buildWorld(scene, 'nebula-drift', worldParams);
  let worldKey = 'nebula-drift';

  /* rim color follows the editor's hue shift so the suit stays lit in-palette */
  function rimFor(k) {
    const base = new THREE.Color(WORLD_RIM[k] || 0x7a5aff);
    if (worldParams && worldParams.hueShift) {
      const hsl = { h: 0, s: 0, l: 0 };
      base.getHSL(hsl);
      base.setHSL((hsl.h + worldParams.hueShift / 360 + 1) % 1, hsl.s, hsl.l);
    }
    return base;
  }

  // ---- camera-anchored person layer (always fills the frame exactly) ----
  const PLANE_D = 2.0;
  const planeH = 2 * Math.tan(THREE.MathUtils.degToRad(34 / 2)) * PLANE_D;
  const planeW = planeH * (W / H);
  let suitLayer = null; // created in start() once the tracker exists

  /* SIM MODE gets a body too: no webcam means no pixels to suit up, so the
     synthetic actor (the Omega Layer's fully-3D VEYL) takes the stage instead.
     Same worlds, same grade, same rim — the preview is never an empty void. */
  let simActor = null;
  const simRoot = new THREE.Group();
  simRoot.position.set(0, 0, -1); // a step upstage so the full body frames in
  scene.add(simRoot);
  const simFace = new Float32Array(FACE_CH);

  /* the composer bypasses the canvas's MSAA entirely — without an explicit
     multisampled HDR target every pass (and therefore the recording) is aliased.
     4x MSAA + half-float = clean silhouette edges and band-free bloom on tape. */
  let composerTarget;
  try {
    composerTarget = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
  } catch (_) { composerTarget = undefined; }
  const composer = composerTarget ? new EffectComposer(renderer, composerTarget) : new EffectComposer(renderer);
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.62, 0.68, 0.76);
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());

  /* ---- RENDER-COST CONTROL ----
     The old capture path rendered the FULL 1080x1920 frame (4x MSAA + bloom +
     the suit shader) and then downscaled it through a per-frame 2D drawImage
     mirror — so a constrained machine paid the full render bill AND a copy on
     top of the encode. When the render loop itself can't hold the tier's fps,
     the picture, the burned-in captions and the line director all stall
     together: exactly "video and caption freeze, lagging too".
     Now the RENDER is downscaled instead: during a scaled take the composer +
     renderer run at the capture resolution directly (no mirror, no copy) and
     MSAA is dropped — the encoder captures the canvas natively. Restored to
     full quality the moment the take ends. */
  const BASE_SAMPLES = 4;
  let renderScale = 1;
  let currentMsaa = BASE_SAMPLES;
  function setMsaa(samples) {
    if (currentMsaa === samples) return; // already there — never churn targets for nothing
    currentMsaa = samples;
    try {
      [composerTarget, composer.renderTarget1, composer.renderTarget2].forEach((t) => {
        if (t && 'samples' in t && t.samples !== samples) { t.samples = samples; t.dispose(); }
      });
    } catch (_) { /* MSAA control is an optimization, never a blocker */ }
  }
  /* CONSISTENT FIRST SECOND — the in-take auto-degrade sheds bloom after the
     loop has spent 1.2s under 22fps. On a machine that ALREADY renders under
     22fps that shed fires ~1.2s into EVERY take: the opening second glows and
     hazes (half-res bloom over a downscaled render), then visibly "snaps
     sharp" when bloom drops. A look change mid-take reads as a defect; the
     same look 1.2s early reads as the style. So any capture that starts on a
     constrained tier (downscaled render OR measured fps already under the
     degrade threshold) sheds bloom BEFORE its first frame — frame zero and
     frame forty are identical. releaseCapture restores bloom for the live
     preview between takes. */
  function applyCaptureQuality(scale) {
    if (scale > 0 && scale < 0.999) applyRenderScale(scale, { msaaOff: true });
    if ((scale > 0 && scale < 0.999) || (fps > 0 && fps < 22)) bloom.enabled = false;
  }

  function applyRenderScale(s, { msaaOff = false } = {}) {
    const samples = msaaOff ? 0 : BASE_SAMPLES;
    /* NO-OP GUARD — re-applying the scale the pipeline is already at used to
       dispose + reallocate every render target anyway (renderer, composer,
       bloom). The warmup probe and the take request the same scale seconds
       apart; without this guard that handoff janked the first recorded frames. */
    if (s === renderScale && samples === currentMsaa) return;
    renderScale = s;
    const w = Math.max(2, Math.round((W * s) / 2) * 2);
    const h = Math.max(2, Math.round((H * s) / 2) * 2);
    setMsaa(samples);
    renderer.setSize(w, h, false); // CSS keeps the canvas at its layout size
    composer.setSize(w, h);
  }

  // ---- HUD burned into the recording (top of frame) ----
  const hudCanvas = document.createElement('canvas'); hudCanvas.width = 1024; hudCanvas.height = 96;
  const hudCtx = hudCanvas.getContext('2d');
  const hudTex = new THREE.CanvasTexture(hudCanvas);
  hudTex.colorSpace = THREE.SRGBColorSpace;
  const hud = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.028), new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthTest: false, depthWrite: false }));
  hud.position.set(0, 0.265, -1); hud.renderOrder = 999;
  camera.add(hud);
  /* OFF by default: uploads must leave the studio with zero burned-in text.
     The HUD only ever draws if the user explicitly turns it on. */
  let hudOn = false;

  function setHud(text) {
    hudCtx.clearRect(0, 0, 1024, 96);
    if (text && hudOn) {
      hudCtx.font = '500 40px "JetBrains Mono", monospace';
      hudCtx.textAlign = 'center';
      hudCtx.fillStyle = 'rgba(255,255,255,0.72)';
      hudCtx.fillText(text.toUpperCase(), 512, 56);
      hudCtx.fillStyle = 'rgba(255,26,46,0.9)';
      hudCtx.fillRect(512 - hudCtx.measureText(text.toUpperCase()).width / 2, 74, hudCtx.measureText(text.toUpperCase()).width, 3);
    }
    hudTex.needsUpdate = true;
  }

  // ---- CAPTION lower-third burned into the recording (bottom of frame) ----
  const capCanvas = document.createElement('canvas'); capCanvas.width = 1024; capCanvas.height = 220;
  const capCtx = capCanvas.getContext('2d');
  const capTex = new THREE.CanvasTexture(capCanvas);
  capTex.colorSpace = THREE.SRGBColorSpace;
  const cap = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.073),
    new THREE.MeshBasicMaterial({ map: capTex, transparent: true, depthTest: false, depthWrite: false }),
  );
  cap.position.set(0, -0.19, -1);
  cap.renderOrder = 1000; // above the suit layer
  camera.add(cap);

  /* ---- THE OVERLAY PLANES (RECOVERY v3 §2 / Phase A3) ----
     Three camera-anchored planes on their OWN canvases, renderOrder 1001+,
     with ZERO contact with the karaoke caption clock — captionRemaining() and
     the auto-cut can never be disturbed by a burn, a CTA flash or an insert.

       burnPlane   — the frame-zero hook (frameZero), 800-weight condensed
                     over a backing bar, ~65% down the frame (ABOVE the
                     karaoke lower-third at y=-0.19: they cannot collide)
       ctaPlane    — the soft CTA, self-clearing ~1s, never queued
       insertPlane — the hiddenFrame glyph+text flash (~0.1s), center frame

     Every clear path wipes all three — uploads and the live preview can never
     carry stray burned text. */
  function makeOverlayPlane(cw, ch, pw, ph, y, order) {
    const cnv = document.createElement('canvas'); cnv.width = cw; cnv.height = ch;
    const ctx = cnv.getContext('2d');
    const tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(pw, ph),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }),
    );
    mesh.position.set(0, y, -1);
    mesh.renderOrder = order;
    camera.add(mesh);
    return { cnv, ctx, tex, mesh, clear() { ctx.clearRect(0, 0, cw, ch); tex.needsUpdate = true; } };
  }
  const burnPlane = makeOverlayPlane(1024, 300, 0.30, 0.088, -0.088, 1001);
  const ctaPlane = makeOverlayPlane(1024, 160, 0.26, 0.041, 0.115, 1002);
  const insertPlane = makeOverlayPlane(1024, 640, 0.30, 0.1875, 0.01, 1003);
  let ctaUntil = 0;     // performance.now()/1000 the CTA self-clears at
  let insertUntil = 0;  // performance.now()/1000 the insert self-clears at

  /** the frame-zero hook — burned at 0.0s, cleared at the reveal.
      800-weight condensed caps on a backing bar; must stay legible at 360px
      width (the plan's pre-publish check). */
  function burn(text) {
    const { ctx, tex } = burnPlane;
    ctx.clearRect(0, 0, 1024, 300);
    if (text) {
      const t = String(text).toUpperCase();
      let size = 132;
      do {
        ctx.font = `800 condensed ${size}px 'Arial Narrow', 'Roboto Condensed', Arial, sans-serif`;
        if (ctx.measureText(t).width <= 940) break;
        size -= 8;
      } while (size > 56);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(t).width;
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.fillRect(512 - w / 2 - 26, 150 - size * 0.62, w + 52, size * 1.24);
      ctx.fillStyle = 'rgba(255,255,255,0.97)';
      ctx.fillText(t, 512, 150);
      ctx.textBaseline = 'alphabetic';
    }
    tex.needsUpdate = true;
  }
  function clearBurn() { burnPlane.clear(); }

  /** the soft CTA — curiosity-phrased (never a command), own plane, ~1s,
      self-clearing, never queued: a second call replaces the first. */
  function flashCta(text, seconds = 1.1) {
    const { ctx, tex } = ctaPlane;
    ctx.clearRect(0, 0, 1024, 160);
    if (text) {
      const t = String(text).toLowerCase();
      let size = 54;
      do {
        ctx.font = `700 ${size}px 'JetBrains Mono', monospace`;
        if (ctx.measureText(t).width <= 920) break;
        size -= 4;
      } while (size > 30);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(t).width;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(512 - w / 2 - 20, 80 - size * 0.72, w + 40, size * 1.44);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(t, 512, 80);
      ctx.textBaseline = 'alphabetic';
      ctaUntil = performance.now() / 1000 + Math.max(0.3, seconds);
    }
    tex.needsUpdate = true;
  }

  /** the hiddenFrame insert — 2-3 frames (~0.1s) of glyph + text, center
      frame. LORE, NEVER SOLICITED: nothing in the audio or CTA may reference
      it. Generic renderer: the glyph always draws; spec.text is optional
      (glyph-only fallback for the inserts the parser can't reduce). */
  function insert(spec, seconds = 0.1) {
    const { ctx, tex } = insertPlane;
    ctx.clearRect(0, 0, 1024, 640);
    // THE GLYPH — the channel's recurring sigil: a broken octagon web-node
    ctx.save();
    ctx.translate(512, 250);
    ctx.strokeStyle = 'rgba(255,46,99,0.95)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      if (i === 5) continue; // the broken segment — always the same one
      const a0 = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((i + 1) / 8) * Math.PI * 2 - Math.PI / 2;
      ctx.moveTo(Math.cos(a0) * 110, Math.sin(a0) * 110);
      ctx.lineTo(Math.cos(a1) * 110, Math.sin(a1) * 110);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 - Math.PI / 4;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * 110, Math.sin(a) * 110);
    }
    ctx.stroke();
    ctx.restore();
    if (spec && spec.text) {
      const t = String(spec.text).toUpperCase();
      let size = 44;
      do {
        ctx.font = `500 ${size}px 'JetBrains Mono', monospace`;
        if (ctx.measureText(t).width <= 940) break;
        size -= 4;
      } while (size > 22);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(t, 512, 470);
    }
    tex.needsUpdate = true;
    insertUntil = performance.now() / 1000 + Math.max(0.05, seconds);
  }

  /** every exit path calls this — no take, preview or upload can carry stray
      burned text out of the studio */
  function clearOverlays() {
    burnPlane.clear(); ctaPlane.clear(); insertPlane.clear();
    ctaUntil = 0; insertUntil = 0;
  }

  /* self-clearing timers, ticked from the render loop */
  function updateOverlays(t) {
    if (ctaUntil > 0 && t >= ctaUntil) { ctaUntil = 0; ctaPlane.clear(); }
    if (insertUntil > 0 && t >= insertUntil) { insertUntil = 0; insertPlane.clear(); }
  }

  function setCaption(text) {
    capAnim = null; // static captions and karaoke captions share the canvas
    capCtx.clearRect(0, 0, 1024, 220);
    if (text) {
      capCtx.font = '500 42px "JetBrains Mono", monospace';
      capCtx.textAlign = 'center';
      // word-wrap into at most 3 lines
      const words = String(text).toUpperCase().split(/\s+/);
      const lines = [];
      let line = '';
      for (const w2 of words) {
        const next = line ? `${line} ${w2}` : w2;
        if (capCtx.measureText(next).width > 940 && line) { lines.push(line); line = w2; }
        else line = next;
        if (lines.length === 3) break;
      }
      if (line && lines.length < 3) lines.push(line);
      const lh = 58;
      const y0 = 110 - ((lines.length - 1) * lh) / 2;
      lines.forEach((l, i) => {
        const w3 = capCtx.measureText(l).width;
        // subtle backing bar so the line reads over any world
        capCtx.fillStyle = 'rgba(0,0,0,0.55)';
        capCtx.fillRect(512 - w3 / 2 - 18, y0 + i * lh - 40, w3 + 36, 54);
        capCtx.fillStyle = 'rgba(255,255,255,0.94)';
        capCtx.fillText(l, 512, y0 + i * lh);
      });
    }
    capTex.needsUpdate = true;
  }

  /* WORD-BY-WORD KARAOKE CAPTIONS — the retention layer. The line's words are
     paced across the spoken audio's real duration and drawn in chunks of up to
     three big bold words, with the active word hot. ~70% of Shorts play in
     sound-compromised situations; these captions carry the video there. */
  let capAnim = null; // { words, start, dur, drawn }
  const CAP_CHUNK = 3;

  function drawCaptionChunk(words, activeIdx) {
    capCtx.clearRect(0, 0, 1024, 220);
    const text = words.join(' ');
    let size = 100;
    do {
      capCtx.font = `800 ${size}px Arial, Helvetica, sans-serif`;
      if (capCtx.measureText(text).width <= 930) break;
      size -= 6;
    } while (size > 48);
    capCtx.textAlign = 'left';
    capCtx.textBaseline = 'middle';
    capCtx.lineJoin = 'round';
    const widths = words.map((w) => capCtx.measureText(`${w} `).width);
    const total = capCtx.measureText(text).width;
    let x = 512 - total / 2;
    const y = 116;
    words.forEach((w, i) => {
      /* PROGRESSIVE REVEAL — words AFTER the active one stay invisible (their
         space is reserved so nothing shifts when they land). Drawing the whole
         chunk up front put the next words on screen before they were spoken —
         exactly "it displays some words before I'm speaking". */
      if (i > activeIdx) { x += widths[i]; return; }
      capCtx.strokeStyle = 'rgba(0,0,0,0.92)';
      capCtx.lineWidth = Math.max(10, size * 0.16);
      capCtx.strokeText(w, x, y);
      capCtx.fillStyle = i === activeIdx ? '#FF2E63' : 'rgba(255,255,255,0.98)';
      capCtx.fillText(w, x, y);
      x += widths[i];
    });
    capCtx.textBaseline = 'alphabetic';
    capTex.needsUpdate = true;
  }

  /** animate a spoken line word-by-word across durationSec.
      holdSec: EXTRA seconds the finished line stays on screen past its
      natural breath — the FINAL line of a take passes the outro window here
      so the closer is readable into the last frame instead of dying with
      its audio.
      opts.startAt: performance.now() ms the line's AUDIO was scheduled — only a
      fallback anchor now; the audio clock below is authoritative.
      opts.clock: () => seconds of this line on the recorder's AudioContext
      timeline (null when it isn't playing). Sampled EVERY frame so render-loop
      stalls are corrected instead of accumulating as drift.
      opts.delay: seconds of silence inside the buffer before the first voiced
      sample — NOTHING draws until it elapses, so the caption never appears
      before the word is actually spoken. */
  function playCaption(text, durationSec = 2.4, holdSec = 0, opts = {}) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) { setCaption(null); return; }
    /* LENGTH-WEIGHTED PACING — a uniform per-word clock makes the highlight
       sprint through long words and camp on short ones, which reads as
       stutter against the audio. Weighting by character count (plus a fixed
       per-word beat) tracks how speech actually spends time, so the hot word
       glides with the voice instead of jumping. cum[i] = the 0..1 fraction of
       the line's duration at which word i ENDS. */
    const weights = words.map((w) => Math.max(2, w.replace(/[^\w]/g, '').length) + 2);
    const total = weights.reduce((s, v) => s + v, 0);
    let acc = 0;
    const cum = weights.map((v) => { acc += v; return acc / total; });
    const anchor = (typeof opts.startAt === 'number' && opts.startAt > 0 ? opts.startAt : performance.now()) / 1000;
    capAnim = {
      words,
      cum,
      /* wall-clock fallback anchor — used only until the audio clock reports, and
         to freewheel after the line's audio has ended */
      t0: anchor,
      leadIn: Math.max(0, opts.delay || 0),
      dur: Math.max(0.5, durationSec),
      hold: Math.max(0, holdSec || 0),
      /* () => seconds of THIS line's audio physically played, or null when it
         isn't playing. Read EVERY frame so latency and render-loop stalls are
         corrected out instead of accumulating into drift. */
      clock: typeof opts.clock === 'function' ? opts.clock : null,
      /* () => confirmed word index | null — live speech recognition. When it
         reports, the karaoke highlight jumps to that EXACT word: no estimate,
         no lap. Time-based pacing stays the automatic fallback. */
      wordIndex: typeof opts.wordIndex === 'function' ? opts.wordIndex : null,
      lastWIdx: -1,    // monotonic guard: recognition can never rewind the highlight
      hasAudio: false, // has the audio clock ever reported?
      lastAudio: 0,    // last authoritative audio-clock reading
      lastWall: 0,     // wall clock at that reading, for freewheeling past it
      drawn: -1,
    };
    /* the previous line's caption clears NOW — during this line's lead-in
       silence the frame stays clean instead of showing stale words */
    capCtx.clearRect(0, 0, 1024, 220);
    capTex.needsUpdate = true;
    /* DRAW IMMEDIATELY (live-mic lines): the performer is already speaking when
       the line fires — waiting for playhead math left them captionless. The
       first chunk renders NOW with word 0 hot; recognition/pacing take over
       from the next frame. */
    if (opts.immediate) {
      capAnim.drawn = 0; // chunk 0, active word 0
      drawCaptionChunk(words.slice(0, CAP_CHUNK), 0);
    }
  }

  /* seconds of the line's audio elapsed, resolved against the AUDIO clock when
     it's live. A caption that keeps its own performance.now() clock cannot
     correct itself: any stall (GC, recording load) is baked in for the rest of
     the line. Re-reading the audio playhead every frame makes drift impossible
     while the line plays, and the wall clock only freewheels the tail. */
  function captionElapsed(a) {
    const wall = performance.now() / 1000;
    if (a.clock) {
      const t = a.clock();
      /* only non-numbers mean "no audio clock available"; zero is a valid
         scheduled start position on the recorder's AudioContext timeline */
      if (typeof t === 'number' && isFinite(t)) {
        a.hasAudio = true;
        a.lastAudio = t;
        a.lastWall = wall;
        return t;
      }
    }
    // audio finished (or never reported): continue from the last true reading
    if (a.hasAudio) return a.lastAudio + (wall - a.lastWall);
    return wall - a.t0;
  }

  /* a finished caption lingers this long past its last word. Formerly the hold
     was `dur * 1.18` — proportional stretch that silently re-added the padding
     the speechDur fix removed (720ms on a 4s line), so long captions outlived
     the voice. A fixed breath clears every line right after the audio. */
  const CAP_BREATH = 0.25;

  /** seconds until the live caption clears (0 when nothing is showing) — the
      auto-cut reads this so the take can never end mid-caption */
  function captionRemaining() {
    if (!capAnim) return 0;
    const t = captionElapsed(capAnim) - capAnim.leadIn;
    return Math.max(0, capAnim.dur + CAP_BREATH + capAnim.hold - t);
  }

  function updateCaptionAnim() {
    if (!capAnim) return;
    // time INTO the spoken words: the buffer's lead-in silence is discounted, so
    // nothing draws until the first word is actually sounding
    const t = captionElapsed(capAnim) - capAnim.leadIn;
    if (t < 0) return;
    const p = t / capAnim.dur;
    // clear a fixed breath past the audio (plus any explicit hold — the final
    // line rides the outro)
    if (t >= capAnim.dur + CAP_BREATH + capAnim.hold) {
      capAnim = null;
      capCtx.clearRect(0, 0, 1024, 220);
      capTex.needsUpdate = true;
      return;
    }
    const n = capAnim.words.length;
    let wIdx = -1;
    /* RECOGNITION FIRST — when the live recognizer confirms a word index, the
       highlight sits on that exact word. Monotonic: a late/retracted interim
       result can never rewind the karaoke. */
    if (capAnim.wordIndex) {
      try {
        const wi = capAnim.wordIndex();
        if (typeof wi === 'number' && isFinite(wi) && wi >= 0) {
          wIdx = Math.min(n - 1, Math.max(Math.floor(wi), capAnim.lastWIdx));
          capAnim.lastWIdx = wIdx;
        }
      } catch (_) { /* recognition is an enhancement, never a blocker */ }
    }
    if (wIdx < 0) {
      // length-weighted lookup: the active word is the first whose END fraction
      // is still ahead of the playhead — matches how the audio spends its time
      const pc = Math.min(0.999, p);
      wIdx = n - 1;
      for (let i = 0; i < n; i++) { if (pc < capAnim.cum[i]) { wIdx = i; break; } }
      // never fall behind what recognition already confirmed
      if (capAnim.lastWIdx >= 0) wIdx = Math.max(wIdx, capAnim.lastWIdx);
    }
    const chunk = Math.floor(wIdx / CAP_CHUNK);
    const key = chunk * 100 + (wIdx % CAP_CHUNK);
    if (key === capAnim.drawn) return;
    capAnim.drawn = key;
    drawCaptionChunk(capAnim.words.slice(chunk * CAP_CHUNK, chunk * CAP_CHUNK + CAP_CHUNK), wIdx % CAP_CHUNK);
  }

  let punchT = -10, glitchT = 0, running = true, lastT = performance.now() / 1000;
  let fpsAcc = 0, fpsN = 0, fps = 0;
  /* IN-TAKE AUTO-DEGRADE — seconds the render loop has spent under ~22fps
     while a capture is live. A struggling take sheds quality instead of
     freezing: first bloom (the priciest pass), then MSAA. Resolution is never
     changed mid-take (an H.264 stream can't survive a resize); everything is
     restored in releaseCapture. */
  let recLowT = 0;

  /* ---- LOOP SURVIVAL LAYER ----
     The old loop was a bare rAF chain: ONE exception anywhere in the frame
     (tracker, beat FX, a world update) killed it permanently — the recording
     kept rolling but the picture, the captions and the line-firing voice
     watcher all froze mid-take. Three guards make the loop unkillable:
     1. the whole frame body runs inside try/catch — an error logs and the
        NEXT frame still schedules;
     2. dual scheduling — rAF drives normally, but a backup timer fires the
        frame if rAF is throttled (occluded window, focus loss, load spikes),
        so voice pacing + captions + capture never stop;
     3. WebGL context loss is survivable — rendering pauses but the loop (and
        therefore the audio direction) keeps running, and drawing resumes the
        moment the context is restored. */
  let rafId = 0, backupTimer = 0;
  let contextLost = false;
  let frameErrLogs = 0;
  let pushFrame = null;       // set when the recorder captures via requestFrame()
  let forcePush = null;       // unthrottled delivery — the recorder's watchdog heartbeat
  let lastCaptureFrame = 0;   // performance.now() of the last frame handed to the encoder

  canvas.addEventListener('webglcontextlost', (e) => {
    try { e.preventDefault(); } catch (_) {}
    contextLost = true;
    console.error('[stage] WebGL context lost — loop continues, rendering paused');
  }, false);
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false;
    console.warn('[stage] WebGL context restored — rendering resumed');
  }, false);

  function scheduleNext(onFrame) {
    if (!running) return;
    rafId = requestAnimationFrame(() => {
      clearTimeout(backupTimer);
      loop(onFrame);
    });
    /* backup: if rAF hasn't fired within 350ms (throttled/occluded), the timer
       drives the frame instead — degraded fps, but NEVER a dead pipeline */
    backupTimer = setTimeout(() => {
      cancelAnimationFrame(rafId);
      loop(onFrame);
    }, 350);
  }

  function loop(onFrame) {
    const t = performance.now() / 1000;
    const dt = Math.min(0.1, t - lastT); lastT = t;
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }

    try {
      if (onFrame) onFrame(t, dt, fps);
      const rig = stage.rig;
      if (rig) rig.tracking.fps = fps; // measured render fps into telemetry
      if (suitLayer && rig) suitLayer.update(t, dt);
      if (simActor && rig) {
        // expression → lens language, matching the AR compositor's EXPR table
        const EXPR_BROW = { calm: 0, fury: -0.9, narrow: -0.55, shock: 0.7, smirk: 0.2 };
        const blink = Math.pow(Math.max(0, Math.sin(t * 0.9)), 48); // a slow natural blink
        simFace[FACE.jaw] = rig.jaw;
        simFace[FACE.blinkL] = Math.max(rig.blinkL, blink);
        simFace[FACE.blinkR] = Math.max(rig.blinkR, blink);
        simFace[FACE.brow] = EXPR_BROW[rig.expression] != null ? EXPR_BROW[rig.expression] : (rig.browUp - rig.browDown);
        simFace[FACE.level] = rig.level;
        simActor.idle(t, simFace, Math.min(1, rig.level * 1.4));
      }
      // audio-reactive worlds: the smoothed voice level pulses the scene
      if (world.setEnergy) world.setEnergy(rig ? rig.level : 0);
      world.update(t, dt);

      // parallax: the space world shifts opposite your real head movement -> true depth
      const rootX = rig ? rig.root.x : 0;
      const rootZ = rig ? rig.root.z : 0;
      // per-world far-layer counter-shift strengthens the depth read
      if (world.parallax) world.parallax(rootX, rig ? rig.root.y || 0 : 0);
      /* RECOVERY 1.2 #2 — a pure sine drift is a mathematically smooth camera,
         which reads synthetic. Banded handheld noise replaces it: the operator
         breathes, the frame never repeats, the subject stays framed. */
      camera.position.x = baseCam.x - rootX * 0.45;
      camera.position.y = baseCam.y;
      camera.position.z = baseCam.z - rootZ * 0.35;
      const sincePunch = t - punchT;
      const punch = sincePunch < 1.2 ? Math.exp(-sincePunch * 4) : 0;
      camera.fov = 34 - punch * 5;
      camera.updateProjectionMatrix();
      camera.lookAt(0, 1.34, 0);
      handheld.apply(camera, t, 0);

      /* THE DOOR's pose rides ON TOP of the handheld solve — the door frames
         the shot, the handheld keeps it human. exposure always applies (1
         when no door/seam is active), so DIM_WORLD can animate the light. */
      if (doorCam.active) {
      camera.translateZ(-doorCam.dolly);
      camera.rotation.y += doorCam.yaw;
      camera.rotation.x += doorCam.pitch;
      camera.rotation.z += doorCam.roll;
      camera.fov += doorCam.fov;
        camera.updateProjectionMatrix();
      }
      renderer.toneMappingExposure = BASE_EXPOSURE * (doorCam.active ? doorCam.exposure : 1);

      if (glitchT > 0) glitchT -= dt;
      updateCaptionAnim();
      updateOverlays(t);
      grade.uniforms.uTime.value = t;
      grade.uniforms.uGlitch.value = Math.max(0, Math.min(1, glitchT * 3));

      /* shed render cost DURING a struggling take instead of freezing it */
      if (pushFrame) {
        if (fps > 0 && fps < 22) recLowT += dt; else recLowT = Math.max(0, recLowT - dt * 2);
        if (recLowT > 1.2 && bloom.enabled) {
          bloom.enabled = false;
          console.warn('[stage] take running hot — bloom off for the rest of the take');
        } else if (recLowT > 3.0) {
          recLowT = 1.3; // MSAA is the last shed — don't re-trigger every frame
          setMsaa(0);
        }
      }

      if (!contextLost) composer.render();
      // hand the freshly rendered frame straight to the encoder (see captureStream)
      if (pushFrame) pushFrame();
    } catch (err) {
      // one bad frame must NEVER kill the take — log a few, keep rolling
      if (frameErrLogs < 5) { frameErrLogs++; console.error('[stage] frame error (loop survives)', err); }
    }
    scheduleNext(onFrame);
  }

  const stage = {
    rig: null,
    scene, camera, renderer,
    start(rig, tracker, onFrame) {
      stage.rig = rig;
      // in sim mode there is no webcam feed — a person layer would just be an opaque black quad
      if (tracker && !tracker.sim && !suitLayer) {
        suitLayer = createSuitLayer(tracker, rig, planeW, planeH);
        suitLayer.group.position.set(0, 0, -PLANE_D);
        suitLayer.setRim(rimFor(worldKey));
        camera.add(suitLayer.group);
      }
      // sim mode: the synthetic VEYL holds the stage so the frame is never empty
      if (tracker && tracker.sim && !simActor) {
        simActor = createActor();
        simActor.setRim(rimFor(worldKey).getHex());
        simRoot.add(simActor.group);
      }
      /* layers are lazy — apply the stored actor-visibility flag AT CREATION,
         so an early-armed door can never leak the character into frame zero */
      applyActorVisible();
      /* SHADER PREWARM — three.js compiles every material the first time it is
         rendered; on the old path those compiles (world + suit compositor +
         bloom + grade, easily 1-2s combined on an integrated GPU) landed inside
         the first LIVE frames: the preview opened frozen and soft. Compiling
         and rendering two full frames HERE — while the boot screen still covers
         the canvas — means the first visible frame already runs at full speed. */
      try {
        const t0 = performance.now() / 1000;
        if (suitLayer) suitLayer.update(t0, 1 / 60);
        world.update(t0, 1 / 60);
        renderer.compile(scene, camera);
        composer.render();
        composer.render();
      } catch (err) { console.warn('[stage] shader prewarm skipped', err); }
      lastT = performance.now() / 1000; // the compile stall must not become a giant first dt
      loop(onFrame);
    },
    setWorld(k, params) {
      if (params !== undefined) worldParams = params && Object.keys(params).length ? { ...params } : null;
      else if (k === worldKey) return; // no params given, same world: nothing to do
      world.dispose(); world = buildWorld(scene, k, worldParams); worldKey = k;
      if (suitLayer) suitLayer.setRim(rimFor(k));
      if (simActor) simActor.setRim(rimFor(k).getHex());
    },
    /* WORLD EDITOR: rebuild the current world with new params (same dispose path) */
    setWorldParams(params) {
      worldParams = params && Object.keys(params).length ? { ...params } : null;
      world.dispose(); world = buildWorld(scene, worldKey, worldParams);
      if (suitLayer) suitLayer.setRim(rimFor(worldKey));
      if (simActor) simActor.setRim(rimFor(worldKey).getHex());
    },
    get worldParams() { return worldParams; },
    get worldKey() { return worldKey; },
    punch() { punchT = performance.now() / 1000; },
    glitch(sec = 0.4) { glitchT = sec; if (stage.rig) stage.rig.glitch = sec; },
    setHud,
    setHudOn(on) { hudOn = on; },
    setCaption,
    playCaption,
    captionRemaining,
    /* ---- THE DOOR surface (RECOVERY v3 §2 / Phase A) ---- */
    doorCam,
    setActorVisible(on) { actorVisible = !!on; applyActorVisible(); },
    burn,
    clearBurn,
    flashCta,
    insert,
    clearOverlays,
    /* measured render fps — the recorder reads this to pick its capture tier */
    get fps() { return fps; },
    /* EXPLICIT FRAME DELIVERY — captureStream(fps) leaves frame timing to the
       browser's dirty-canvas heuristic, which is exactly the path that stalls
       the video track mid-take under load (frozen picture, audio continues).
       captureStream(0) + requestFrame() after every composer.render() hands
       each finished frame straight to the encoder — throttled to the tier's
       fps so a fast render loop can't flood a slow encoder. Falls back to the
       classic fps-hint stream where requestFrame isn't supported.

       TRUE RENDER DOWNSCALE (scale < 1): the old path rendered the full
       1080x1920 frame and copied it through a per-frame 2D mirror — full
       render bill PLUS a copy, on the machines that could afford neither.
       Now the RENDERER itself runs at the capture resolution (MSAA off for
       the take), and the encoder captures the canvas natively: render cost
       drops ~44% at 0.75 / ~56% at 2/3, and the mirror copy is gone. */
    captureStream(fpsWanted = 60, scale = 1) {
      applyCaptureQuality(scale);
      /* FIRST-SECOND SHARPNESS — MediaRecorder rides Chromium's WebRTC encoder
         stack, whose quality scaler opens every session in "balanced" mode: while
         rate control ramps (the first ~1s) it is allowed to DOWNSCALE the frames
         it encodes, then adapts back up — soft, low-res opening second, perfect
         after. contentHint='detail' flips the track to maintain-resolution: the
         encoder may drop a frame under pressure but must encode every frame it
         takes at the track's full resolution, from frame zero. */
      const pinDetail = (mediaStream) => {
        try {
          mediaStream.getVideoTracks().forEach((t) => { t.contentHint = 'detail'; });
        } catch (_) { /* hint is an optimization, never a blocker */ }
        return mediaStream;
      };
      try {
        const s = pinDetail(canvas.captureStream(0));
        const track = s.getVideoTracks()[0];
        if (track && typeof track.requestFrame === 'function') {
          const minGap = 1 / Math.max(1, fpsWanted);
          let lastPush = 0;
          /* unthrottled delivery — used by the render loop (via the throttle
             below) AND by the recorder's watchdog when the loop hiccups */
          const deliver = () => {
            if (track.readyState !== 'live') { pushFrame = null; forcePush = null; return; }
            try {
              track.requestFrame();
              lastCaptureFrame = performance.now();
            } catch (_) { pushFrame = null; forcePush = null; }
          };
          pushFrame = () => {
            const now = performance.now() / 1000;
            if (now - lastPush < minGap * 0.85) return;
            lastPush = now;
            deliver();
          };
          forcePush = deliver;
          lastCaptureFrame = performance.now();
          return s;
        }
      } catch (_) { /* fall through to the fps-hint capture */ }
      return pinDetail(canvas.captureStream(fpsWanted));
    },
    /* DIRECT FRAME SINK — the WebCodecs recording path. Instead of a
       MediaStream (whose WebRTC encoder stack owns rate control and opens
       every session soft — the blurry first second), the recorder registers a
       sink callback here and encodes the canvas itself via VideoEncoder.
       The render loop invokes the sink right after composer.render() —
       throttled to the tier's fps — so every encoded frame is a finished,
       full-resolution frame from frame zero. Same render-downscale and
       watchdog semantics as captureStream; returns the live canvas so the
       recorder can build its CanvasSource on it. */
    captureFrames(fpsWanted = 30, scale = 1, sink = null) {
      applyCaptureQuality(scale);
      if (typeof sink === 'function') {
        const minGap = 1 / Math.max(1, fpsWanted);
        let lastPush = 0;
        const deliver = () => {
          try {
            sink();
            lastCaptureFrame = performance.now();
          } catch (_) { pushFrame = null; forcePush = null; }
        };
        pushFrame = () => {
          const now = performance.now() / 1000;
          if (now - lastPush < minGap * 0.85) return;
          lastPush = now;
          deliver();
        };
        forcePush = deliver;
        lastCaptureFrame = performance.now();
      }
      return canvas;
    },
    /* recorder watchdog surface: when was a frame last handed to the encoder,
       and force one through NOW if the render loop is hiccuping */
    get lastCaptureFrameAt() { return lastCaptureFrame; },
    forceCaptureFrame() { if (forcePush) forcePush(); },
    /* LAG FIX: the recorder calls this when a take ends (stop/cancel/warmup).
       Without it the capture closures keep running on EVERY rendered frame
       forever, stacking one more per take/restart: permanent, compounding
       lag after the first recording. Releasing them returns the render loop
       to its pre-take cost, and full render quality (native res, MSAA,
       bloom) comes back the moment the take is over. */
    releaseCapture({ keepScale = false } = {}) {
      pushFrame = null; forcePush = null;
      recLowT = 0;
      /* keepScale: the countdown warmup probe hands off to the real take —
         leave the take's render scale (AND its bloom shed) in place so REC
         starts on an already warm, already allocated pipeline: zero realloc,
         zero resolution snap, zero look change in the first recorded frames.
         Full quality restores at take end. */
      if (keepScale) return;
      bloom.enabled = true;
      if (renderScale !== 1) applyRenderScale(1);
      else setMsaa(BASE_SAMPLES);
    },
    dispose() {
      running = false;
      cancelAnimationFrame(rafId);
      clearTimeout(backupTimer);
      pushFrame = null;
      forcePush = null;
      world.dispose(); if (suitLayer) suitLayer.dispose(); if (simActor) simActor.dispose(); renderer.dispose();
    },
  };
  return stage;
}

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
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  renderer.setSize(W, H, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, W / H, 0.1, 200);
  const baseCam = new THREE.Vector3(0, 1.18, 3.5);
  camera.position.copy(baseCam);
  scene.add(camera);

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
      hasAudio: false, // has the audio clock ever reported?
      lastAudio: 0,    // last authoritative audio-clock reading
      lastWall: 0,     // wall clock at that reading, for freewheeling past it
      drawn: -1,
    };
    /* the previous line's caption clears NOW — during this line's lead-in
       silence the frame stays clean instead of showing stale words */
    capCtx.clearRect(0, 0, 1024, 220);
    capTex.needsUpdate = true;
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
    // length-weighted lookup: the active word is the first whose END fraction
    // is still ahead of the playhead — matches how the audio spends its time
    const pc = Math.min(0.999, p);
    let wIdx = n - 1;
    for (let i = 0; i < n; i++) { if (pc < capAnim.cum[i]) { wIdx = i; break; } }
    const chunk = Math.floor(wIdx / CAP_CHUNK);
    const key = chunk * 100 + (wIdx % CAP_CHUNK);
    if (key === capAnim.drawn) return;
    capAnim.drawn = key;
    drawCaptionChunk(capAnim.words.slice(chunk * CAP_CHUNK, chunk * CAP_CHUNK + CAP_CHUNK), wIdx % CAP_CHUNK);
  }

  let punchT = -10, glitchT = 0, running = true, lastT = performance.now() / 1000;
  let fpsAcc = 0, fpsN = 0, fps = 0;

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
  let pushFrame = null; // set when the recorder captures via requestFrame()

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
      const drift = 0.05;
      camera.position.x = baseCam.x + Math.sin(t * 0.11) * drift - rootX * 0.45;
      camera.position.y = baseCam.y + Math.sin(t * 0.09 + 2) * drift * 0.5;
      camera.position.z = baseCam.z - rootZ * 0.35;
      const sincePunch = t - punchT;
      const punch = sincePunch < 1.2 ? Math.exp(-sincePunch * 4) : 0;
      camera.fov = 34 - punch * 5;
      camera.updateProjectionMatrix();
      camera.lookAt(0, 1.34, 0);

      if (glitchT > 0) glitchT -= dt;
      updateCaptionAnim();
      grade.uniforms.uTime.value = t;
      grade.uniforms.uGlitch.value = Math.max(0, Math.min(1, glitchT * 3));

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
    /* measured render fps — the recorder reads this to pick its capture tier */
    get fps() { return fps; },
    /* EXPLICIT FRAME DELIVERY — captureStream(fps) leaves frame timing to the
       browser's dirty-canvas heuristic, which is exactly the path that stalls
       the video track mid-take under load (frozen picture, audio continues).
       captureStream(0) + requestFrame() after every composer.render() hands
       each finished frame straight to the encoder — throttled to the tier's
       fps so a fast render loop can't flood a slow encoder. Falls back to the
       classic fps-hint stream where requestFrame isn't supported. */
    captureStream(fpsWanted = 60) {
      try {
        const s = canvas.captureStream(0);
        const track = s.getVideoTracks()[0];
        if (track && typeof track.requestFrame === 'function') {
          const minGap = 1 / Math.max(1, fpsWanted);
          let lastPush = 0;
          pushFrame = () => {
            if (track.readyState !== 'live') { pushFrame = null; return; }
            const now = performance.now() / 1000;
            if (now - lastPush < minGap * 0.85) return;
            lastPush = now;
            try { track.requestFrame(); } catch (_) { pushFrame = null; }
          };
          return s;
        }
      } catch (_) { /* fall through to the fps-hint capture */ }
      return canvas.captureStream(fpsWanted);
    },
    dispose() {
      running = false;
      cancelAnimationFrame(rafId);
      clearTimeout(backupTimer);
      pushFrame = null;
      world.dispose(); if (suitLayer) suitLayer.dispose(); if (simActor) simActor.dispose(); renderer.dispose();
    },
  };
  return stage;
}

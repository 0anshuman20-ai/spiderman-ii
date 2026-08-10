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
  let hudOn = true;

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
  setHud('COSMIC WEAVER ── STANDBY');

  // ---- CAPTION lower-third burned into the recording (bottom of frame) ----
  const capCanvas = document.createElement('canvas'); capCanvas.width = 1024; capCanvas.height = 220;
  const capCtx = capCanvas.getContext('2d');
  const capTex = new THREE.CanvasTexture(capCanvas);
  capTex.colorSpace = THREE.SRGBColorSpace;
  const cap = new THREE.Mesh(
    new THREE.PlaneGeometry(0.30, 0.064),
    new THREE.MeshBasicMaterial({ map: capTex, transparent: true, depthTest: false, depthWrite: false }),
  );
  cap.position.set(0, -0.20, -1);
  cap.renderOrder = 1000; // above the suit layer
  camera.add(cap);

  function setCaption(text) {
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

  let punchT = -10, glitchT = 0, running = true, lastT = performance.now() / 1000;
  let fpsAcc = 0, fpsN = 0, fps = 0;

  function loop(onFrame) {
    const t = performance.now() / 1000;
    const dt = Math.min(0.1, t - lastT); lastT = t;
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }

    if (onFrame) onFrame(t, dt, fps);
    const rig = stage.rig;
    if (suitLayer && rig) suitLayer.update(t, dt);
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
    grade.uniforms.uTime.value = t;
    grade.uniforms.uGlitch.value = Math.max(0, Math.min(1, glitchT * 3));

    composer.render();
    if (running) requestAnimationFrame(() => loop(onFrame));
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
      loop(onFrame);
    },
    setWorld(k, params) {
      if (params !== undefined) worldParams = params && Object.keys(params).length ? { ...params } : null;
      else if (k === worldKey) return; // no params given, same world: nothing to do
      world.dispose(); world = buildWorld(scene, k, worldParams); worldKey = k;
      if (suitLayer) suitLayer.setRim(rimFor(k));
    },
    /* WORLD EDITOR: rebuild the current world with new params (same dispose path) */
    setWorldParams(params) {
      worldParams = params && Object.keys(params).length ? { ...params } : null;
      world.dispose(); world = buildWorld(scene, worldKey, worldParams);
      if (suitLayer) suitLayer.setRim(rimFor(worldKey));
    },
    get worldParams() { return worldParams; },
    get worldKey() { return worldKey; },
    punch() { punchT = performance.now() / 1000; },
    glitch(sec = 0.4) { glitchT = sec; if (stage.rig) stage.rig.glitch = sec; },
    setHud,
    setHudOn(on) { hudOn = on; },
    setCaption,
    captureStream(fpsWanted = 60) { return canvas.captureStream(fpsWanted); },
    dispose() { running = false; world.dispose(); if (suitLayer) suitLayer.dispose(); renderer.dispose(); },
  };
  return stage;
}

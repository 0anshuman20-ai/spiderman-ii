/* Stage: 1080x1920 three.js pipeline with cinematic camera, bloom + CRT post, burned-in HUD. */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createAvatar } from './avatar';
import { buildWorld } from './worlds';

const W = 1080, H = 1920;

const CRTShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGlitch: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uGlitch;
    varying vec2 vUv;
    float rand(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      if (uGlitch > 0.01) {
        float band = step(0.92, rand(vec2(floor(uv.y * 40.0), floor(uTime * 30.0))));
        uv.x += band * (rand(vec2(uTime, uv.y)) - 0.5) * 0.12 * uGlitch;
      }
      float ca = 0.0012 + uGlitch * 0.008;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + vec2(ca, 0.0)).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - vec2(ca, 0.0)).b;
      float scan = 0.94 + 0.06 * sin(uv.y * 1920.0 * 1.7);
      col *= scan;
      col += (rand(uv * uTime) - 0.5) * 0.035;
      float d = distance(uv, vec2(0.5));
      col *= 1.0 - d * d * 0.55;
      col *= 1.0 - uGlitch * 0.15;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  renderer.setSize(W, H, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  // studio-grade reflections for lenses & suit sheen
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(34, W / H, 0.1, 200);
  const baseCam = new THREE.Vector3(0, 1.18, 3.5);
  camera.position.copy(baseCam);

  // core lighting (worlds add their own accents)
  const key = new THREE.DirectionalLight(0xcfd8ff, 1.3); key.position.set(2, 3, 4); scene.add(key);
  const rim = new THREE.PointLight(0xff2038, 18, 12); rim.position.set(-1.5, 2.2, -1.4); scene.add(rim);
  scene.add(new THREE.AmbientLight(0x222236, 0.9));

  const avatar = createAvatar();
  scene.add(avatar.group);

  let world = buildWorld(scene, 'nebula-drift');
  let worldKey = 'nebula-drift';

  const composer = new EffectComposer(renderer);
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.45, 0.45, 0.85);
  composer.addPass(bloom);
  const crt = new ShaderPass(CRTShader);
  composer.addPass(crt);

  // HUD burned into the recording
  const hudCanvas = document.createElement('canvas'); hudCanvas.width = 1024; hudCanvas.height = 96;
  const hudCtx = hudCanvas.getContext('2d');
  const hudTex = new THREE.CanvasTexture(hudCanvas);
  const hud = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.058), new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthTest: false }));
  hud.position.set(0, 0.72, -1); hud.renderOrder = 999;
  camera.add(hud); scene.add(camera);
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

  let punchT = -10, glitchT = 0, running = true, lastT = performance.now() / 1000;
  let fpsAcc = 0, fpsN = 0, fps = 0;

  function loop(onFrame) {
    const nowMs = performance.now();
    const t = nowMs / 1000;
    const dt = Math.min(0.1, t - lastT); lastT = t;
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }

    if (onFrame) onFrame(t, dt, fps);
    avatar.update(stage.rig, t, dt);
    world.update(t, dt);

    // cinematic drift + punch-in
    const drift = 0.06;
    camera.position.x = baseCam.x + Math.sin(t * 0.13) * drift;
    camera.position.y = baseCam.y + Math.sin(t * 0.1 + 2) * drift * 0.5;
    const sincePunch = t - punchT;
    const punch = sincePunch < 1.2 ? Math.exp(-sincePunch * 4) : 0;
    camera.fov = 34 - punch * 5;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 1.34, 0);

    if (glitchT > 0) glitchT -= dt;
    crt.uniforms.uTime.value = t;
    crt.uniforms.uGlitch.value = Math.max(0, Math.min(1, glitchT * 3));

    composer.render();
    if (running) requestAnimationFrame(() => loop(onFrame));
  }

  const stage = {
    rig: null,
    scene, camera, renderer,
    start(rig, onFrame) { stage.rig = rig; loop(onFrame); },
    setWorld(k) {
      if (k === worldKey) return;
      world.dispose(); world = buildWorld(scene, k); worldKey = k;
    },
    get worldKey() { return worldKey; },
    punch() { punchT = performance.now() / 1000; },
    glitch(sec = 0.4) { glitchT = sec; if (stage.rig) stage.rig.glitch = sec; },
    setHud,
    setHudOn(on) { hudOn = on; },
    captureStream(fpsWanted = 60) { return canvas.captureStream(fpsWanted); },
    dispose() { running = false; world.dispose(); renderer.dispose(); },
  };
  return stage;
}

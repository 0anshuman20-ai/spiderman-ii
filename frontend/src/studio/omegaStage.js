/* THE OMEGA STAGE — Ω.1 / Ω.3 substrate

   The live stage is camera-anchored: your webcam plane is glued to the lens, so the
   camera can never move. This stage has no webcam at all. It renders the Synthetic
   Actor inside the same five worlds with a free 6DOF camera and the same bloom +
   filmic grade the live stage burns into tape — because a synthetic shot that does
   not grade like a matted shot will never cut against one.

   The clock here is the SHOT clock: time comes from the shot, not the wall, so a
   seek is exact and two renders of the same shot produce the same image. */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildWorld } from './worlds';
import { readActiveParams } from './worldPresets';
import { createActor } from './actor';
import { sampleAt, meanVisibility, FACE_CH, J } from './perf';
import { createCinema } from './synth';
import { createNovelView, stillCamera } from './novelview';

const W = 1080, H = 1920;

const WORLD_RIM = {
  'nebula-drift': 0x7a5aff,
  'red-planet': 0xff8844,
  'derelict-station': 0x55ccff,
  'asteroid-earth': 0x6699ff,
  'dying-star': 0xff6a33,
};

/* identical grade to the live stage — this is the continuity contract */
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
      col += (rand(uv * (uTime + 1.0)) - 0.5) * 0.011;
      float d = distance(uv, vec2(0.5, 0.48));
      col *= 1.0 - d * d * 0.42;
      col *= 1.0 - uGlitch * 0.12;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/* ------------------------------------------------------------------ */
/* CAMERA RIGS — the whole point of the Omega Layer.
   Each rig is a pure function of shot progress u (0..1) and the actor's chest
   height, so it is deterministic, seekable and re-renderable forever.
   `MEDIUM` deliberately reproduces the live stage framing: it is the shot that
   lets a synthetic take intercut with a performed one without a visible seam. */
export const CAMERA_RIGS = [
  {
    key: 'medium', name: 'MEDIUM — MATCHES LIVE', badge: 'intercut',
    solve: (u, c) => ({ pos: [0.0, c.y + 0.22, 3.5 - u * 0.18], look: [0, c.y + 0.16, 0], fov: 34 }),
  },
  {
    key: 'wide-crane', name: 'WIDE CRANE DOWN', badge: 'establisher',
    solve: (u, c) => ({ pos: [2.6 - u * 0.9, 7.4 - u * 5.2, 9.4 - u * 3.1], look: [0, c.y * (0.5 + u * 0.5), 0], fov: 42 - u * 6 }),
  },
  {
    key: 'low-hero', name: 'LOW HERO', badge: 'hero',
    solve: (u, c) => ({ pos: [-0.5 + u * 0.2, 0.34, 2.1 - u * 0.35], look: [0, c.y + 0.30, 0], fov: 30 }),
  },
  {
    key: 'over-shoulder', name: 'OVER SHOULDER', badge: 'reverse',
    solve: (u, c) => ({ pos: [0.62, c.y + 0.34, -1.55 - u * 0.25], look: [-0.18, c.y + 0.12, 0.6], fov: 38 }),
  },
  {
    key: 'orbit-180', name: 'ORBIT 180°', badge: 'coverage',
    solve: (u, c) => {
      const a = -Math.PI * 0.42 + u * Math.PI * 0.92;
      const r = 2.35;
      return { pos: [Math.sin(a) * r, c.y + 0.18 + Math.sin(u * Math.PI) * 0.24, Math.cos(a) * r], look: [0, c.y + 0.1, 0], fov: 33 };
    },
  },
  {
    key: 'top-down', name: 'TOP DOWN FALL', badge: 'vertigo',
    solve: (u, c) => ({ pos: [0.1, 8.6 - u * 3.0, 0.55], look: [0, c.y * 0.4, 0], fov: 46 }),
  },
  {
    key: 'far-rooftop', name: 'FAR — 40 METRES', badge: 'scale',
    solve: (u) => ({ pos: [12.5 - u * 2.2, 5.6, 36 - u * 5.0], look: [0, 1.1, 0], fov: 16 }),
  },
  {
    key: 'swing-chase', name: 'SWING CHASE', badge: 'stunt',
    solve: (u, c) => ({ pos: [3.1 - u * 1.4, c.y + 1.1 + Math.sin(u * Math.PI) * 0.7, 4.4 - u * 1.1], look: [0, c.y + 0.2, 0], fov: 40 }),
  },
];

export const RIG_BY_KEY = CAMERA_RIGS.reduce((m, r) => { m[r.key] = r; return m; }, {});

/* ------------------------------------------------------------------ */

export function createOmegaStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(W, H, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, W / H, 0.1, 400);
  scene.add(camera);

  /* episodes honor whatever the live studio dialed in — same preset lookup */
  let worldKey = 'nebula-drift';
  let world = buildWorld(scene, worldKey, readActiveParams(worldKey));

  const actor = createActor();
  actor.setRim(WORLD_RIM[worldKey]);
  scene.add(actor.group);

  /* the ground the foot lock stands on — without it a wide shot has no floor
     and the actor reads as floating, which is exactly how CG betrays itself */
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x0b0b12, roughness: 0.82, metalness: 0.15 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 48), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.002;
  scene.add(floor);

  let composerTarget;
  try { composerTarget = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 }); } catch (_) { composerTarget = undefined; }
  const composer = composerTarget ? new EffectComposer(renderer, composerTarget) : new EffectComposer(renderer);
  composer.setSize(W, H);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.62, 0.68, 0.76));
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  /* Ω.3 — the Cinema Finish: deterministic photographic pass, per shot, A/B-able */
  const cinema = createCinema();
  composer.addPass(cinema.pass);
  composer.addPass(new OutputPass());

  /* Ω.3 — the still scene: a 2.5D depth mesh lives in its own graph so a STILL
     shot swaps the RenderPass scene instead of fighting the world for the frame */
  const stillScene = new THREE.Scene();
  stillScene.background = new THREE.Color(0x000000);
  let stillView = null;
  let stillReady = false;

  /* burned-in source badge: no synthetic frame ever leaves this studio unlabelled */
  const badgeCanvas = document.createElement('canvas'); badgeCanvas.width = 1024; badgeCanvas.height = 96;
  const badgeCtx = badgeCanvas.getContext('2d');
  const badgeTex = new THREE.CanvasTexture(badgeCanvas);
  badgeTex.colorSpace = THREE.SRGBColorSpace;
  const badge = new THREE.Mesh(
    new THREE.PlaneGeometry(0.30, 0.028),
    new THREE.MeshBasicMaterial({ map: badgeTex, transparent: true, depthTest: false, depthWrite: false }),
  );
  badge.position.set(0, 0.265, -1);
  badge.renderOrder = 999;
  camera.add(badge);
  let badgeOn = true;

  function setBadge(text) {
    badgeCtx.clearRect(0, 0, 1024, 96);
    if (text && badgeOn) {
      badgeCtx.font = '500 40px "JetBrains Mono", monospace';
      badgeCtx.textAlign = 'center';
      badgeCtx.fillStyle = 'rgba(255,255,255,0.72)';
      badgeCtx.fillText(text.toUpperCase(), 512, 56);
      const w = badgeCtx.measureText(text.toUpperCase()).width;
      badgeCtx.fillStyle = 'rgba(255,26,46,0.9)';
      badgeCtx.fillRect(512 - w / 2, 74, w, 3);
    }
    badgeTex.needsUpdate = true;
  }

  /* ---- shot state ---- */
  const jointBuf = new Float32Array(J * 3);
  const faceBuf = new Float32Array(FACE_CH);
  const chest = { y: 1.24 };
  let shot = null;          // { performance, rig, world, in, out, stunt, label }
  let clock = 0;            // seconds inside the shot
  let playing = false;
  let raf = 0;
  let lastWall = 0;
  let onTick = null;
  let onEnd = null;
  let stuntSolver = null;

  function setWorld(k) {
    if (!k || k === worldKey) return;
    world.dispose();
    worldKey = k;
    world = buildWorld(scene, worldKey, readActiveParams(worldKey));
    actor.setRim(WORLD_RIM[worldKey] || 0x7a5aff);
  }

  function solveCamera(u) {
    const rig = RIG_BY_KEY[(shot && shot.rig) || 'medium'] || RIG_BY_KEY.medium;
    const s = rig.solve(u, chest);
    camera.position.set(s.pos[0], s.pos[1], s.pos[2]);
    camera.fov = s.fov;
    camera.updateProjectionMatrix();
    camera.lookAt(s.look[0], s.look[1], s.look[2]);
  }

  /** draw exactly one frame of the loaded shot at time `t` seconds */
  function renderAt(t) {
    if (!shot) return;
    const dur = Math.max(0.033, shot.out - shot.in);
    const u = Math.max(0, Math.min(1, t / dur));
    const perf = shot.performance;

    /* Ω.3 — STILL shot: the depth mesh IS the frame; a seeded dolly moves through it */
    if (shot.still) {
      if (!stillReady) return;                      // image still decoding — first frame lands on resolve
      const s = stillCamera(u, stillView.planeH, shot.still.seed || 11);
      camera.position.set(s.pos[0], s.pos[1], s.pos[2]);
      camera.fov = s.fov;
      camera.updateProjectionMatrix();
      camera.lookAt(s.look[0], s.look[1], s.look[2]);
      grade.uniforms.uGlitch.value = 0;
      grade.uniforms.uTime.value = t;
      cinema.tick(t);
      composer.render();
      if (onTick) onTick(t, dur);
      return;
    }

    if (perf) {
      const pt = shot.in + t;
      sampleAt(perf, pt, jointBuf, faceBuf);
      const frame = Math.min(perf.frames - 1, Math.round(pt * perf.fps));
      let conf = meanVisibility(perf, frame);
      if (stuntSolver) conf = stuntSolver.solve(t, jointBuf, conf);
      // offline snaps (no easing lag); a live stunt window owns the root outright
      actor.applyPose(jointBuf, faceBuf, conf, 1, stuntSolver ? stuntSolver.root : null);
      grade.uniforms.uGlitch.value = faceBuf[9] > 0.5 ? 0.35 : 0;
    } else {
      actor.idle(t);
      grade.uniforms.uGlitch.value = 0;
    }

    chest.y = Math.max(0.6, actor.head.position.y + actor.group.position.y - 0.34);
    solveCamera(u);
    world.update(t + (shot.worldPhase || 0), 1 / 30);
    grade.uniforms.uTime.value = t;
    cinema.tick(t);
    composer.render();
    if (onTick) onTick(t, dur);
  }

  let fpsAcc = 0, fpsN = 0, fps = 0;

  function loop() {
    if (!playing) return;
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - lastWall);
    lastWall = now;
    clock += dt;
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
    const dur = Math.max(0.033, shot.out - shot.in);
    if (clock >= dur) {
      renderAt(dur);
      playing = false;
      if (onEnd) onEnd();
      return;
    }
    renderAt(clock);
    raf = requestAnimationFrame(loop);
  }

  const api = {
    scene, camera, renderer, actor,
    get worldKey() { return worldKey; },
    get playing() { return playing; },
    get time() { return clock; },
    get duration() { return shot ? Math.max(0.033, shot.out - shot.in) : 0; },

    /** load a shot: performance (or null for procedural idle) OR a 2.5D still,
        + camera rig + world + cinema finish strength — all direction-track values */
    load(next) {
      shot = {
        performance: null, rig: 'medium', world: worldKey, in: 0, out: 3,
        worldPhase: 0, label: '', still: null, cinema: 0, cinemaSeed: 11, ...next,
      };
      stuntSolver = shot.stunt || null;
      setBadge(shot.label);
      cinema.strength = shot.cinema || 0;
      cinema.seed = shot.cinemaSeed || 11;
      clock = 0;

      /* tear down any previous still view */
      if (stillView) { stillScene.remove(stillView.group); stillView.dispose(); stillView = null; }
      stillReady = false;

      if (shot.still) {
        /* STILL shot: swap the render graph, rebuild the depth mesh, first frame on resolve */
        const mine = shot;
        stillScene.add(camera);
        renderPass.scene = stillScene;
        createNovelView(shot.still).then((view) => {
          if (shot !== mine) { view.dispose(); return; }   // superseded while decoding
          stillView = view;
          stillScene.add(view.group);
          stillReady = true;
          renderAt(clock);
        }).catch(() => { /* undecodable still: shot renders black, never throws */ });
      } else {
        scene.add(camera);
        renderPass.scene = scene;
        setWorld(shot.world);
        renderAt(0);
      }
      return api;
    },

    /** Ω.3 — live strength / A-B without reloading the shot; re-renders the held frame */
    setCinema(strength) {
      if (!shot) return;
      shot.cinema = strength;
      cinema.strength = strength;
      if (!playing) renderAt(clock);
    },
    setBadgeOn(on) { badgeOn = on; setBadge(shot ? shot.label : ''); },
    setLabel(text) { if (shot) shot.label = text; setBadge(text); },
    seek(t) { clock = Math.max(0, Math.min(api.duration, t)); renderAt(clock); },
    play(handlers = {}) {
      if (!shot) return;
      onTick = handlers.onTick || null;
      onEnd = handlers.onEnd || null;
      if (clock >= api.duration - 0.01) clock = 0;
      playing = true;
      lastWall = performance.now() / 1000;
      raf = requestAnimationFrame(loop);
    },
    pause() { playing = false; cancelAnimationFrame(raf); },
    /* measured playback fps — the recorder reads this to pick its capture tier */
    get fps() { return fps; },
    captureStream(fpsWanted = 60) { return canvas.captureStream(fpsWanted); },
    dispose() {
      playing = false; cancelAnimationFrame(raf);
      if (stillView) { stillScene.remove(stillView.group); stillView.dispose(); stillView = null; }
      world.dispose(); actor.dispose();
      floor.geometry.dispose(); floorMat.dispose();
      badge.geometry.dispose(); badge.material.dispose();
      renderer.dispose();
    },
  };
  return api;
}

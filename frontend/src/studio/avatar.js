/* Procedural VEYL avatar: masked figure, black/crimson web-circuit suit, teardrop spider lenses.
   Fully rigged: head, torso, articulated arms with fingered hands, articulated legs, root motion.
   Driven by the rig object — mirrors the performer like an AR filter. */
import * as THREE from 'three';

const CRIMSON = 0xff1a2e;
const DOWN = new THREE.Vector3(0, -1, 0);

function webCircuitTexture(size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2;
  g.strokeStyle = '#ff2038'; g.lineWidth = 2.2; g.globalAlpha = 0.95;
  for (let r = 26; r < size * 0.72; r += 40) {
    g.beginPath();
    for (let a = 0; a <= 14; a++) {
      const th = (a / 14) * Math.PI * 2;
      const rr = r * (1 + 0.05 * Math.sin(a * 3.1 + r));
      const x = cx + Math.cos(th) * rr, y = cy + Math.sin(th) * rr;
      if (a) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
  }
  for (let a = 0; a < 14; a++) {
    const th = (a / 14) * Math.PI * 2;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(th) * size * 0.72, cy + Math.sin(th) * size * 0.72); g.stroke();
  }
  g.fillStyle = '#ff3348';
  for (let i = 0; i < 70; i++) g.fillRect(Math.random() * size, Math.random() * size, 3, 3);
  const tx = new THREE.CanvasTexture(c);
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  return tx;
}

function lensGeometry() {
  // classic teardrop spider lens: wide rounded outer-top, tapered toward inner-bottom
  const s = new THREE.Shape();
  s.moveTo(0, -0.052);
  s.bezierCurveTo(0.048, -0.036, 0.062, 0.012, 0.04, 0.046);
  s.bezierCurveTo(0.018, 0.074, -0.032, 0.068, -0.046, 0.038);
  s.bezierCurveTo(-0.06, 0.008, -0.032, -0.036, 0, -0.052);
  return new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 3, curveSegments: 24 });
}

function fingerChain(mat, x, thumb = false) {
  const base = new THREE.Group(); base.position.set(x, -0.085, 0.004);
  const s1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.007, 0.026, 3, 6), mat);
  s1.position.y = -0.017; base.add(s1);
  const j2 = new THREE.Group(); j2.position.y = -0.036; base.add(j2);
  const s2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0062, 0.02, 3, 6), mat);
  s2.position.y = -0.014; j2.add(s2);
  if (thumb) { base.position.set(x, -0.045, 0.012); base.rotation.z = x > 0 ? -0.9 : 0.9; }
  return { base, j2 };
}

export function createAvatar() {
  const group = new THREE.Group();
  const webTex = webCircuitTexture();
  const suit = new THREE.MeshStandardMaterial({
    color: 0x16060a, roughness: 0.5, metalness: 0.25, envMapIntensity: 0.7,
    emissive: CRIMSON, emissiveMap: webTex, emissiveIntensity: 0.75,
  });
  const suitPlain = new THREE.MeshStandardMaterial({ color: 0x0c0c12, roughness: 0.55, metalness: 0.3, envMapIntensity: 0.6 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x1a0508, roughness: 0.3, metalness: 0.4, emissive: CRIMSON, emissiveIntensity: 1.8 });
  const lensMat = new THREE.MeshPhysicalMaterial({
    color: 0xeef2ff, roughness: 0.08, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06,
    envMapIntensity: 1.0, emissive: 0xbdc9e8, emissiveIntensity: 0.1,
  });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x050507, roughness: 0.35, metalness: 0.6, envMapIntensity: 0.8 });

  // ---------- HEAD ----------
  const head = new THREE.Group(); head.position.set(0, 1.5, 0); group.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.142, 48, 48), suit);
  skull.scale.set(1, 1.14, 1.05); head.add(skull);

  const lensGeo = lensGeometry();
  const mkLens = (side) => {
    const lg = new THREE.Group();
    const rim = new THREE.Mesh(lensGeo, rimMat);
    rim.scale.set(1.18, 1.18, 0.7); rim.position.z = -0.004;
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lg.add(rim); lg.add(lens);
    if (side < 0) lg.scale.x = -1; // mirror the teardrop
    lg.scale.multiplyScalar(0.88);
    lg.position.set(side * 0.072, 0.022, 0.118);
    lg.rotation.set(-0.1, side * 0.46, side * 0.14);
    head.add(lg);
    return lg;
  };
  const lensR = mkLens(1), lensL = mkLens(-1);
  const mkBrow = (side) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.009, 0.012), accent);
    b.position.set(side * 0.066, 0.1, 0.122);
    b.rotation.z = side * 0.2;
    head.add(b);
    return b;
  };
  const browR = mkBrow(1), browL = mkBrow(-1);
  const jaw = new THREE.Group(); jaw.position.set(0, -0.06, 0.02); head.add(jaw);
  const jawPlate = new THREE.Mesh(new THREE.SphereGeometry(0.135, 32, 20, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), suitPlain);
  jawPlate.scale.set(0.98, 1.25, 1.0); jawPlate.position.y = 0.05; jaw.add(jawPlate);
  const voiceBar = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.009), new THREE.MeshBasicMaterial({ color: CRIMSON, transparent: true, opacity: 0.9 }));
  voiceBar.position.set(0, -0.026, 0.126); jaw.add(voiceBar);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.058, 0.1, 16), suitPlain);
  neck.position.set(0, 1.36, 0); group.add(neck);

  // ---------- TORSO (heroic V-shape) ----------
  const torso = new THREE.Group(); torso.position.set(0, 1.0, 0); group.add(torso);
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.22, 8, 24), suit);
  chest.position.y = 0.21; chest.scale.set(1.3, 1, 0.78); torso.add(chest);
  const traps = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 18), suit);
  traps.position.y = 0.32; traps.scale.set(1.5, 0.5, 0.75); torso.add(traps);
  const waist = new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.16, 8, 20), suitPlain);
  waist.position.y = -0.06; waist.scale.set(1.1, 1, 0.8); torso.add(waist);
  // emblem: radiating node
  const emblem = new THREE.Group(); emblem.position.set(0, 0.25, 0.15); torso.add(emblem);
  emblem.add(new THREE.Mesh(new THREE.CircleGeometry(0.016, 20), new THREE.MeshBasicMaterial({ color: CRIMSON })));
  for (let i = 0; i < 8; i++) {
    const th = (i / 8) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.0045), new THREE.MeshBasicMaterial({ color: CRIMSON, transparent: true, opacity: 0.85 }));
    leg.position.set(Math.cos(th) * 0.042, Math.sin(th) * 0.042, 0);
    leg.rotation.z = th; emblem.add(leg);
  }
  const mkPad = (side) => {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 18), suit);
    p.position.set(side * 0.26, 0.3, 0); p.scale.set(1.15, 0.9, 1); torso.add(p);
    return p;
  };
  mkPad(1); mkPad(-1);
  // shoulder particle glow
  const sparkGeo = new THREE.BufferGeometry();
  const sparkN = 46; const sparkPos = new Float32Array(sparkN * 3); const sparkSeed = [];
  for (let i = 0; i < sparkN; i++) {
    const side = i % 2 ? 1 : -1;
    sparkSeed.push({ side, a: Math.random() * Math.PI * 2, r: 0.06 + Math.random() * 0.09, sp: 0.4 + Math.random() });
    sparkPos.set([side * 0.26, 1.31, 0], i * 3);
  }
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: 0xff4455, size: 0.012, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
  group.add(sparks);

  // ---------- PELVIS + ARTICULATED LEGS ----------
  const pelvis = new THREE.Group(); pelvis.position.set(0, 0.85, 0); group.add(pelvis);
  const hipMesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 16), suitPlain);
  hipMesh.scale.set(1.2, 0.72, 0.9); pelvis.add(hipMesh);
  const buildLeg = (side) => {
    const hip = new THREE.Group(); hip.position.set(side * 0.095, -0.04, 0); pelvis.add(hip);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.064, 0.26, 6, 14), suit);
    thigh.position.y = -0.17; hip.add(thigh);
    const knee = new THREE.Group(); knee.position.y = -0.36; hip.add(knee);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.24, 6, 14), suitPlain);
    shin.position.y = -0.16; knee.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.05, 0.17), suitPlain);
    foot.position.set(0, -0.36, 0.045); knee.add(foot);
    return { hip, knee, side };
  };
  const legR = buildLeg(1), legL = buildLeg(-1);

  // ---------- ARMS ----------
  const buildArm = (side) => { // side: +1 viewer-right
    const shoulder = new THREE.Group(); shoulder.position.set(side * 0.275, 0.29, 0); torso.add(shoulder);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.2, 6, 14), suit);
    upper.position.y = -0.14; shoulder.add(upper);
    const elbow = new THREE.Group(); elbow.position.y = -0.28; shoulder.add(elbow);
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.041, 0.18, 6, 14), suitPlain);
    fore.position.y = -0.125; elbow.add(fore);
    const wrist = new THREE.Group(); wrist.position.y = -0.25; elbow.add(wrist);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.075, 0.026), suit);
    palm.position.y = -0.045; wrist.add(palm);
    const fingers = [];
    [-0.022, -0.0075, 0.0075, 0.022].forEach((x) => { const f = fingerChain(suitPlain, x); wrist.add(f.base); fingers.push(f); });
    const thumb = fingerChain(suitPlain, side * 0.034, true); wrist.add(thumb.base); fingers.push(thumb);
    return { shoulder, elbow, wrist, fingers, side };
  };
  const armR = buildArm(1), armL = buildArm(-1);

  // reusable math objects
  const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), qInv = new THREE.Quaternion();
  const vTmp = new THREE.Vector3();

  const EXPR = {
    calm: { lens: 1, lensAsym: 0, browY: 0, browTilt: 0, glow: 1 },
    fury: { lens: 0.42, lensAsym: 0, browY: -0.018, browTilt: 0.5, glow: 3.0 },
    narrow: { lens: 0.55, lensAsym: 0, browY: -0.008, browTilt: 0.15, glow: 1.4 },
    shock: { lens: 1.42, lensAsym: 0, browY: 0.02, browTilt: -0.2, glow: 2.0 },
    smirk: { lens: 0.85, lensAsym: 0.45, browY: 0.004, browTilt: 0.05, glow: 1.3 },
  };
  const exprState = { lens: 1, lensAsym: 0, browY: 0, browTilt: 0, glow: 1 };

  function applyArm(arm, data, t, dt, k) {
    if (data.vis > 0.35) {
      qA.setFromUnitVectors(DOWN, vTmp.copy(data.up).normalize());
      arm.shoulder.quaternion.slerp(qA, k);
      qB.setFromUnitVectors(DOWN, vTmp.copy(data.fore).normalize());
      qInv.copy(arm.shoulder.quaternion).invert();
      qB.premultiply(qInv);
      arm.elbow.quaternion.slerp(qB, k);
    } else {
      const s = arm.side;
      qA.setFromEuler(new THREE.Euler(0.12 + 0.05 * Math.sin(t * 0.8 + s), 0, s * -0.16 + s * -0.03 * Math.sin(t * 0.6)));
      arm.shoulder.quaternion.slerp(qA, k * 0.5);
      qB.setFromEuler(new THREE.Euler(0.35 + 0.08 * Math.sin(t * 0.7 + s * 2), 0, s * -0.05));
      arm.elbow.quaternion.slerp(qB, k * 0.5);
    }
    const curl = THREE.MathUtils.clamp(data.curl, 0, 1);
    arm.fingers.forEach((f) => {
      f.base.rotation.x = -curl * 1.5;
      f.j2.rotation.x = -curl * 1.7;
    });
  }

  function applyLeg(leg, data, t, k) {
    if (data && data.vis > 0.35) {
      qA.setFromUnitVectors(DOWN, vTmp.copy(data.thigh).normalize());
      leg.hip.quaternion.slerp(qA, k);
      qB.setFromUnitVectors(DOWN, vTmp.copy(data.shin).normalize());
      qInv.copy(leg.hip.quaternion).invert();
      qB.premultiply(qInv);
      leg.knee.quaternion.slerp(qB, k);
    } else {
      const s = leg.side;
      qA.setFromEuler(new THREE.Euler(0.02 * Math.sin(t * 0.5 + s), 0, s * -0.04));
      leg.hip.quaternion.slerp(qA, k * 0.4);
      qB.setFromEuler(new THREE.Euler(0.05 + 0.02 * Math.sin(t * 0.6 + s * 2), 0, 0));
      leg.knee.quaternion.slerp(qB, k * 0.4);
    }
  }

  let glitchT = 0;

  function update(rig, t, dt) {
    const k = 1 - Math.exp(-dt * 16);
    const kb = 1 - Math.exp(-dt * 12);
    // head
    head.rotation.set(
      THREE.MathUtils.clamp(rig.headPitch, -0.7, 0.7),
      THREE.MathUtils.clamp(rig.headYaw, -1.1, 1.1),
      THREE.MathUtils.clamp(rig.headRoll, -0.6, 0.6),
      'YXZ'
    );
    // expressions
    const target = EXPR[rig.expression] || EXPR.calm;
    ['lens', 'lensAsym', 'browY', 'browTilt', 'glow'].forEach((key) => {
      exprState[key] += (target[key] - exprState[key]) * k;
    });
    const wideEye = 1 + rig.browUp * 0.25;
    lensR.scale.y = Math.max(0.08, exprState.lens * wideEye * (1 - rig.blinkR * 0.92) * (1 + exprState.lensAsym * 0.3));
    lensL.scale.y = Math.max(0.08, exprState.lens * wideEye * (1 - rig.blinkL * 0.92) * (1 - exprState.lensAsym * 0.35));
    lensMat.emissiveIntensity = 0.18 * exprState.glow;
    lensMat.emissive.setHex(exprState.glow > 2 ? CRIMSON : 0xbdc9e8);
    browR.position.y = 0.1 + exprState.browY + rig.browUp * 0.02 - rig.browDown * 0.015;
    browL.position.y = browR.position.y;
    browR.rotation.z = 0.2 + exprState.browTilt;
    browL.rotation.z = -0.2 - exprState.browTilt;
    // jaw + voice bar
    const talk = Math.max(rig.jaw, rig.level * 0.9);
    jaw.position.y = -0.06 - talk * 0.028;
    jaw.rotation.x = talk * 0.22;
    voiceBar.scale.set(0.4 + talk * 1.6 + rig.smile * 0.5, 1 + talk * 2.2, 1);
    voiceBar.material.opacity = 0.35 + talk * 0.65;
    // torso
    torso.rotation.z = THREE.MathUtils.clamp(rig.torso.roll, -0.4, 0.4);
    torso.rotation.y = THREE.MathUtils.clamp(rig.torso.yaw, -0.5, 0.5);
    torso.rotation.x = THREE.MathUtils.clamp(rig.torso.lean, -0.35, 0.35) + 0.012 * Math.sin(t * 1.7);
    chest.scale.x = 1.3 + 0.008 * Math.sin(t * 1.7); // breathing
    // root motion — mirror the performer's position in frame
    const root = rig.root || { x: 0, y: 0, z: 0 };
    group.position.x += (root.x - group.position.x) * kb;
    group.position.z += (root.z - group.position.z) * kb;
    group.position.y += (root.y + 0.012 * Math.sin(t * 0.9) - group.position.y) * kb;
    // limbs
    applyArm(armR, rig.arms.r, t, dt, kb);
    applyArm(armL, rig.arms.l, t, dt, kb);
    applyLeg(legR, rig.legs && rig.legs.r, t, kb);
    applyLeg(legL, rig.legs && rig.legs.l, t, kb);
    // shoulder sparks
    const pos = sparks.geometry.attributes.position;
    for (let i = 0; i < sparkN; i++) {
      const s = sparkSeed[i];
      s.a += dt * s.sp;
      pos.setXYZ(i, group.position.x + s.side * 0.26 + Math.cos(s.a) * s.r * 0.4, group.position.y + 1.31 + Math.sin(s.a * 0.7) * s.r, group.position.z + Math.sin(s.a) * s.r * 0.4);
    }
    pos.needsUpdate = true;
    // suit pulse with voice (kept subtle for realism)
    suit.emissiveIntensity = 0.65 + rig.level * 0.6 + 0.05 * Math.sin(t * 2.3);
    // glitch burst
    if (rig.glitch > 0) { glitchT = rig.glitch; rig.glitch = 0; }
    if (glitchT > 0) {
      glitchT -= dt;
      const j = () => (Math.random() - 0.5) * 0.12;
      head.rotation.x += j(); head.rotation.y += j();
      torso.rotation.z += j() * 0.4;
      suit.emissiveIntensity = 0.3 + Math.random() * 2.5;
    }
  }

  return { group, update, materials: { suit, accent, lensMat } };
}

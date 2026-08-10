/* MediaPipe face + pose + hands tracker. Writes smoothed values into the shared rig object.
   Also provides SIM mode: procedural performance when no camera is available. */
import { FilesetResolver, FaceLandmarker, PoseLandmarker, HandLandmarker } from '@mediapipe/tasks-vision';
import * as THREE from 'three';

export function makeRig() {
  return {
    headYaw: 0, headPitch: 0, headRoll: 0,
    blinkL: 0, blinkR: 0, browUp: 0, browDown: 0, jaw: 0, smile: 0, pucker: 0,
    torso: { lean: 0, roll: 0, yaw: 0 },
    root: { x: 0, y: 0, z: 0 },
    legs: {
      r: { thigh: new THREE.Vector3(0, -1, 0), shin: new THREE.Vector3(0, -1, 0), vis: 0 },
      l: { thigh: new THREE.Vector3(0, -1, 0), shin: new THREE.Vector3(0, -1, 0), vis: 0 },
    },
    arms: {
      // +x = viewer's right (avatar left side). dir vectors in avatar space.
      r: { up: new THREE.Vector3(0.25, -0.95, 0), fore: new THREE.Vector3(0.1, -1, 0), vis: 0, curl: 0.25 },
      l: { up: new THREE.Vector3(-0.25, -0.95, 0), fore: new THREE.Vector3(-0.1, -1, 0), vis: 0, curl: 0.25 },
    },
    level: 0, expression: 'calm', glitch: 0,
    tracking: { face: false, pose: false, hands: false, fps: 0, mode: 'off' },
  };
}

const lerp = (a, b, k) => a + (b - a) * k;

export class Tracker {
  constructor(rig) {
    this.rig = rig;
    this.sim = false;
    this.running = false;
    this.lastVideoTime = -1;
    this.frame = 0;
    this._m4 = new THREE.Matrix4();
    this._e = new THREE.Euler();
    this._tmp = new THREE.Vector3();
    this.raw = { yaw: 0, pitch: 0, roll: 0 };
  }

  async init() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30 } });
      const video = document.createElement('video');
      video.srcObject = this.stream; video.muted = true; video.playsInline = true;
      await video.play();
      this.video = video;
      const fileset = await FilesetResolver.forVisionTasks('/wasm');
      const base = (path) => ({ baseOptions: { modelAssetPath: path, delegate: 'GPU' }, runningMode: 'VIDEO' });
      try {
        this.face = await FaceLandmarker.createFromOptions(fileset, { ...base('/models/face_landmarker.task'), numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true });
        this.pose = await PoseLandmarker.createFromOptions(fileset, { ...base('/models/pose_landmarker_lite.task'), numPoses: 1 });
        this.hands = await HandLandmarker.createFromOptions(fileset, { ...base('/models/hand_landmarker.task'), numHands: 2 });
      } catch (gpuErr) {
        const cbase = (path) => ({ baseOptions: { modelAssetPath: path, delegate: 'CPU' }, runningMode: 'VIDEO' });
        this.face = await FaceLandmarker.createFromOptions(fileset, { ...cbase('/models/face_landmarker.task'), numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true });
        this.pose = await PoseLandmarker.createFromOptions(fileset, { ...cbase('/models/pose_landmarker_lite.task'), numPoses: 1 });
        this.hands = await HandLandmarker.createFromOptions(fileset, { ...cbase('/models/hand_landmarker.task'), numHands: 2 });
      }
      this.running = true;
      this.rig.tracking.mode = 'live';
      return true;
    } catch (err) {
      this.error = err.message;
      return false;
    }
  }

  startSim() { this.sim = true; this.running = true; this.rig.tracking.mode = 'sim'; }

  tick(t, dt) {
    if (!this.running) return;
    if (this.sim) { this.simTick(t, dt); return; }
    const v = this.video;
    if (!v || v.readyState < 2 || v.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = v.currentTime;
    const now = performance.now();
    this.frame++;
    const kFace = 1 - Math.exp(-dt * 14);
    const kBody = 1 - Math.exp(-dt * 9);
    const rig = this.rig;

    try {
      const fr = this.face.detectForVideo(v, now);
      if (fr.faceBlendshapes && fr.faceBlendshapes.length) {
        rig.tracking.face = true;
        const bs = {};
        fr.faceBlendshapes[0].categories.forEach((c) => { bs[c.categoryName] = c.score; });
        rig.blinkL = lerp(rig.blinkL, bs.eyeBlinkRight || 0, kFace); // mirrored
        rig.blinkR = lerp(rig.blinkR, bs.eyeBlinkLeft || 0, kFace);
        rig.jaw = lerp(rig.jaw, Math.min(1, (bs.jawOpen || 0) * 1.6), kFace);
        rig.browUp = lerp(rig.browUp, bs.browInnerUp || 0, kFace);
        rig.browDown = lerp(rig.browDown, Math.max(bs.browDownLeft || 0, bs.browDownRight || 0), kFace);
        rig.smile = lerp(rig.smile, Math.max(bs.mouthSmileLeft || 0, bs.mouthSmileRight || 0), kFace);
        rig.pucker = lerp(rig.pucker, bs.mouthPucker || 0, kFace);
      } else { rig.tracking.face = false; }
      if (fr.facialTransformationMatrixes && fr.facialTransformationMatrixes.length) {
        this._m4.fromArray(fr.facialTransformationMatrixes[0].data);
        this._e.setFromRotationMatrix(this._m4, 'YXZ');
        rig.headYaw = lerp(rig.headYaw, -this._e.y, kFace);   // mirror
        rig.headPitch = lerp(rig.headPitch, this._e.x, kFace);
        rig.headRoll = lerp(rig.headRoll, this._e.z, kFace);
      }
    } catch (_) { rig.tracking.face = false; }

    try {
      const pr = this.pose.detectForVideo(v, now);
      const wl = pr.worldLandmarks && pr.worldLandmarks[0];
      if (wl && wl.length >= 17) {
        rig.tracking.pose = true;
        const P = (i) => new THREE.Vector3(-wl[i].x, -wl[i].y, -wl[i].z); // mirror x, flip y
        const vis = (i) => (wl[i].visibility != null ? wl[i].visibility : 1);
        const sL = P(11), sR = P(12), eL = P(13), eR = P(14), wL = P(15), wR = P(16);
        // user LEFT (11,13,15) appears mirrored at -x => drives avatar arm at... mirrored P already flips x.
        // shoulder line -> torso roll & yaw
        const shDir = sR.clone().sub(sL);
        rig.torso.roll = lerp(rig.torso.roll, Math.atan2(shDir.y, shDir.x) * 0.7, kBody);
        rig.torso.yaw = lerp(rig.torso.yaw, -shDir.z * 1.6, kBody);
        const mid = sL.clone().add(sR).multiplyScalar(0.5);
        rig.torso.lean = lerp(rig.torso.lean, THREE.MathUtils.clamp(mid.z * 1.2, -0.35, 0.35), kBody);
        const setArm = (arm, sh, el, wr, vv) => {
          arm.vis = lerp(arm.vis, vv, kBody);
          if (vv > 0.4) {
            const up = el.clone().sub(sh).normalize();
            const fo = wr.clone().sub(el).normalize();
            arm.up.lerp(up, kBody); arm.fore.lerp(fo, kBody);
          }
        };
        // mirrored: user's right arm (12,14,16) now has +x coords => avatar +x ('r' slot = viewer right)
        setArm(rig.arms.r, sR, eR, wR, Math.min(vis(12), vis(14), vis(16)));
        setArm(rig.arms.l, sL, eL, wL, Math.min(vis(11), vis(13), vis(15)));
        // legs (thigh + shin), same convention
        const setLeg = (leg, hip, knee, ankle, vv) => {
          leg.vis = lerp(leg.vis, vv, kBody);
          if (vv > 0.4) {
            leg.thigh.lerp(knee.clone().sub(hip).normalize(), kBody);
            leg.shin.lerp(ankle.clone().sub(knee).normalize(), kBody);
          }
        };
        if (wl.length >= 29) {
          setLeg(rig.legs.r, P(24), P(26), P(28), Math.min(vis(24), vis(26), vis(28)));
          setLeg(rig.legs.l, P(23), P(25), P(27), Math.min(vis(23), vis(25), vis(27)));
        }
        // root motion — mirror the performer's position in frame (AR-filter feel)
        const nl = pr.landmarks && pr.landmarks[0];
        if (nl) {
          const mx = (i) => 1 - nl[i].x;
          const hipsVisible = vis(23) > 0.5 && vis(24) > 0.5;
          const anchorX = hipsVisible ? (mx(23) + mx(24)) / 2 : (mx(11) + mx(12)) / 2;
          rig.root.x = lerp(rig.root.x, THREE.MathUtils.clamp((anchorX - 0.5) * 2.0, -0.85, 0.85), kBody);
          const sw = Math.abs(nl[11].x - nl[12].x); // shoulder width => distance proxy
          if (sw > 0.02) {
            rig.root.z = lerp(rig.root.z, THREE.MathUtils.clamp((sw / 0.17 - 1) * 1.3, -0.9, 1.0), kBody * 0.6);
          }
          if (hipsVisible) { // crouch / stand follows you
            const hipY = (nl[23].y + nl[24].y) / 2;
            rig.root.y = lerp(rig.root.y, THREE.MathUtils.clamp((0.66 - hipY) * 0.9, -0.35, 0.1), kBody * 0.6);
          } else {
            rig.root.y = lerp(rig.root.y, 0, kBody * 0.4);
          }
        }
      } else { rig.tracking.pose = false; }
    } catch (_) { rig.tracking.pose = false; }

    if (this.frame % 2 === 0) {
      try {
        const hr = this.hands.detectForVideo(v, now);
        if (hr.landmarks && hr.landmarks.length) {
          rig.tracking.hands = true;
          hr.landmarks.forEach((lm, idx) => {
            const label = hr.handedness[idx] && hr.handedness[idx][0] ? hr.handedness[idx][0].categoryName : 'Left';
            // raw (unmirrored) image: reported 'Left' == user's RIGHT hand -> avatar 'r'
            const slot = label === 'Left' ? 'r' : 'l';
            const d = (a, b) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y, (lm[a].z || 0) - (lm[b].z || 0));
            const palm = d(9, 0) || 0.001;
            let curl = 0;
            [[8, 5], [12, 9], [16, 13], [20, 17]].forEach(([tip, mcp]) => {
              curl += THREE.MathUtils.clamp(1.4 - d(tip, 0) / (d(mcp, 0) + palm * 0.9), 0, 1);
            });
            this.rig.arms[slot].curl = lerp(this.rig.arms[slot].curl, curl / 4, 0.35);
          });
        } else { rig.tracking.hands = false; }
      } catch (_) { rig.tracking.hands = false; }
    }
  }

  simTick(t, dt) {
    const rig = this.rig;
    const k = 1 - Math.exp(-dt * 8);
    rig.tracking.face = rig.tracking.pose = rig.tracking.hands = true;
    rig.headYaw = lerp(rig.headYaw, 0.28 * Math.sin(t * 0.55), k);
    rig.headPitch = lerp(rig.headPitch, 0.1 * Math.sin(t * 0.83 + 1), k);
    rig.headRoll = lerp(rig.headRoll, 0.06 * Math.sin(t * 0.4), k);
    const blink = (t % 3.6) < 0.14 ? 1 : 0;
    rig.blinkL = lerp(rig.blinkL, blink, 0.5); rig.blinkR = lerp(rig.blinkR, blink, 0.5);
    const talking = (Math.sin(t * 0.32) > -0.4) ? 1 : 0;
    const jaw = talking * Math.max(0, 0.45 * Math.sin(t * 9.1) + 0.3 * Math.sin(t * 13.7) + 0.2);
    rig.jaw = lerp(rig.jaw, jaw, 0.5);
    rig.level = lerp(rig.level, jaw * 0.8, 0.4);
    rig.browUp = lerp(rig.browUp, 0.3 + 0.3 * Math.sin(t * 0.7), k);
    rig.torso.roll = lerp(rig.torso.roll, 0.05 * Math.sin(t * 0.5), k);
    rig.torso.lean = lerp(rig.torso.lean, 0.08 * Math.sin(t * 0.3), k);
    const gesture = 0.5 + 0.5 * Math.sin(t * 0.45);
    rig.arms.r.vis = rig.arms.l.vis = 1;
    rig.arms.r.up.lerp(new THREE.Vector3(0.5 + 0.2 * Math.sin(t * 0.7), -0.75 + gesture * 0.45, 0.2), k);
    rig.arms.r.fore.lerp(new THREE.Vector3(0.15 * Math.sin(t * 1.1), -0.35 + gesture * 0.75, 0.55 + 0.2 * Math.sin(t * 0.9)), k);
    rig.arms.l.up.lerp(new THREE.Vector3(-0.45, -0.9 + 0.15 * Math.sin(t * 0.6 + 2), 0.1), k);
    rig.arms.l.fore.lerp(new THREE.Vector3(-0.2, -0.75, 0.3 + 0.15 * Math.sin(t * 0.8 + 1)), k);
    rig.arms.r.curl = lerp(rig.arms.r.curl, 0.2 + 0.25 * Math.sin(t * 1.3), k);
    rig.arms.l.curl = lerp(rig.arms.l.curl, 0.3, k);
    // root wander + weight shift + legs
    rig.root.x = lerp(rig.root.x, 0.3 * Math.sin(t * 0.25), k);
    rig.root.z = lerp(rig.root.z, 0.25 * Math.sin(t * 0.18 + 1), k);
    rig.root.y = lerp(rig.root.y, Math.min(0, -0.12 * Math.sin(t * 0.15)), k);
    rig.legs.r.vis = rig.legs.l.vis = 1;
    const shift = 0.08 * Math.sin(t * 0.4);
    rig.legs.r.thigh.lerp(new THREE.Vector3(0.1 + shift, -0.98, 0.05 * Math.sin(t * 0.3)), k);
    rig.legs.r.shin.lerp(new THREE.Vector3(0.02, -1, 0.05), k);
    rig.legs.l.thigh.lerp(new THREE.Vector3(-0.1 + shift, -0.98, 0), k);
    rig.legs.l.shin.lerp(new THREE.Vector3(-0.02, -1, 0.04), k);
  }

  dispose() {
    this.running = false;
    try {
      if (this.stream) this.stream.getTracks().forEach((tr) => tr.stop());
      if (this.face) this.face.close(); if (this.pose) this.pose.close(); if (this.hands) this.hands.close();
    } catch (_) {}
  }
}

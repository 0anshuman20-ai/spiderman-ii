/* AR-filter tracker. The webcam feed is mirrored + cover-cropped to 9:16 into a canvas.
   FaceLandmarker + PoseLandmarker run on that exact canvas, so every landmark is already
   in final screen space. ImageSegmenter produces a person confidence mask so the real
   background can be replaced with the 3D space world. No puppet — the suit is painted
   onto YOUR pixels. */
import { FilesetResolver, FaceLandmarker, PoseLandmarker, HandLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision';

export function makeRig() {
  return {
    // face signals (smoothed 0..1)
    blinkL: 0, blinkR: 0, browUp: 0, browDown: 0, jaw: 0, smile: 0, pucker: 0,
    headRoll: 0, headYaw: 0, headPitch: 0,
    // performer position in frame (drives background parallax)
    root: { x: 0, y: 0, z: 0 },
    level: 0, expression: 'calm', glitch: 0,
    tracking: { face: false, pose: false, hands: false, fps: 0, mode: 'off' },
  };
}

const lerp = (a, b, k) => a + (b - a) * k;

// crop resolution — the person layer texture (9:16)
export const CROP_W = 720;
export const CROP_H = 1280;
// segmentation runs on a smaller canvas for speed; mask upscales smoothly on the GPU
const SEG_W = 288;
const SEG_H = 512;

export class Tracker {
  constructor(rig) {
    this.rig = rig;
    this.sim = false;
    this.running = false;
    this.lastVideoTime = -1;
    this.frame = 0;

    // cropped, mirrored, 9:16 video — the base layer of the filter
    this.canvas = document.createElement('canvas');
    this.canvas.width = CROP_W; this.canvas.height = CROP_H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false });

    this.segCanvas = document.createElement('canvas');
    this.segCanvas.width = SEG_W; this.segCanvas.height = SEG_H;
    this.segCtx = this.segCanvas.getContext('2d', { willReadFrequently: false });

    // everything the suit compositor needs, in crop-UV space (x right, y down, 0..1)
    this.points = {
      face: {
        ok: 0, // confidence fade 0..1
        eyeL: { x: 0.42, y: 0.4 }, eyeR: { x: 0.58, y: 0.4 },
        center: { x: 0.5, y: 0.42 }, chin: { x: 0.5, y: 0.55 }, forehead: { x: 0.5, y: 0.3 },
        eyeDist: 0.08, angle: 0,
        mouth: { x: 0.5, y: 0.5 }, mouthW: 0.05, mouthOpen: 0,
      },
      pose: { ok: 0, lm: null }, // raw normalized pose landmarks (already in crop space)
      // up to two hands, 21 landmarks each, smoothed in crop space — drives real gloved fingers
      hands: { list: [ { ok: 0, lm: null }, { ok: 0, lm: null } ] },
      seg: { ok: false, data: null, w: SEG_W, h: SEG_H, version: 0 },
    };
  }

  async init() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      });
      const video = document.createElement('video');
      video.srcObject = this.stream; video.muted = true; video.playsInline = true;
      await video.play();
      this.video = video;
      const fileset = await FilesetResolver.forVisionTasks('/wasm');
      const mk = (delegate) => async () => {
        const base = (path) => ({ baseOptions: { modelAssetPath: path, delegate }, runningMode: 'VIDEO' });
        this.face = await FaceLandmarker.createFromOptions(fileset, {
          ...base('/models/face_landmarker.task'), numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
        });
        this.pose = await PoseLandmarker.createFromOptions(fileset, { ...base('/models/pose_landmarker_lite.task'), numPoses: 1 });
        this.hand = await HandLandmarker.createFromOptions(fileset, { ...base('/models/hand_landmarker.task'), numHands: 2 });
        this.seg = await ImageSegmenter.createFromOptions(fileset, {
          ...base('/models/selfie_segmenter.tflite'), outputConfidenceMasks: true, outputCategoryMask: false,
        });
      };
      try { await mk('GPU')(); } catch (_) { await mk('CPU')(); }
      this.running = true;
      this.rig.tracking.mode = 'live';
      return true;
    } catch (err) {
      this.error = err.message;
      return false;
    }
  }

  startSim() { this.sim = true; this.running = true; this.rig.tracking.mode = 'sim'; }

  /* draw the mirrored cover-crop of the webcam into the 9:16 canvas */
  drawCrop() {
    const v = this.video;
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return false;
    const targetAspect = CROP_W / CROP_H;
    let sw = vh * targetAspect, sh = vh;
    if (sw > vw) { sw = vw; sh = vw / targetAspect; }
    const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
    const g = this.ctx;
    g.save();
    g.translate(CROP_W, 0); g.scale(-1, 1); // mirror
    g.drawImage(v, sx, sy, sw, sh, 0, 0, CROP_W, CROP_H);
    g.restore();
    return true;
  }

  tick(t, dt) {
    if (!this.running) return;
    if (this.sim) { this.simTick(t, dt); return; }
    const v = this.video;
    if (!v || v.readyState < 2 || v.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = v.currentTime;
    if (!this.drawCrop()) return;
    const now = performance.now();
    this.frame++;
    const rig = this.rig;
    const pts = this.points;
    const kFace = 1 - Math.exp(-dt * 20); // fast — the mask must feel glued to you
    const kPos = 1 - Math.exp(-dt * 26);  // near-instant landmark follow, tiny denoise
    const kBody = 1 - Math.exp(-dt * 10);

    /* ---- FACE (every frame — this drives the mask + lenses) ---- */
    try {
      const fr = this.face.detectForVideo(this.canvas, now);
      const lm = fr.faceLandmarks && fr.faceLandmarks[0];
      if (lm) {
        rig.tracking.face = true;
        pts.face.ok = lerp(pts.face.ok, 1, kFace);
        const f = pts.face;
        const sm = (p, i) => { p.x = lerp(p.x, lm[i].x, kPos); p.y = lerp(p.y, lm[i].y, kPos); };
        // canonical face-mesh indices: eye corners 33/133 (viewer-left eye), 362/263 (viewer-right)
        const eLx = (lm[33].x + lm[133].x) / 2, eLy = (lm[33].y + lm[133].y) / 2;
        const eRx = (lm[362].x + lm[263].x) / 2, eRy = (lm[362].y + lm[263].y) / 2;
        f.eyeL.x = lerp(f.eyeL.x, eLx, kPos); f.eyeL.y = lerp(f.eyeL.y, eLy, kPos);
        f.eyeR.x = lerp(f.eyeR.x, eRx, kPos); f.eyeR.y = lerp(f.eyeR.y, eRy, kPos);
        sm(f.center, 168);   // nose bridge between the eyes
        sm(f.chin, 152); sm(f.forehead, 10);
        sm(f.mouth, 13);     // upper inner lip center
        const aspect = CROP_H / CROP_W;
        f.eyeDist = lerp(f.eyeDist, Math.hypot(eRx - eLx, (eRy - eLy) * aspect), kPos);
        f.angle = lerp(f.angle, Math.atan2((eRy - eLy) * aspect, eRx - eLx), kPos);
        f.mouthW = lerp(f.mouthW, Math.hypot(lm[308].x - lm[78].x, (lm[308].y - lm[78].y) * aspect), kPos);
        f.mouthOpen = lerp(f.mouthOpen, Math.hypot(lm[14].x - lm[13].x, (lm[14].y - lm[13].y) * aspect), kPos);
      } else {
        rig.tracking.face = false;
        pts.face.ok = lerp(pts.face.ok, 0, kFace * 0.5);
      }
      if (fr.faceBlendshapes && fr.faceBlendshapes.length) {
        const bs = {};
        fr.faceBlendshapes[0].categories.forEach((c) => { bs[c.categoryName] = c.score; });
        // input is pre-mirrored, so reported Left/Right already match the viewer
        rig.blinkL = lerp(rig.blinkL, bs.eyeBlinkLeft || 0, kFace);
        rig.blinkR = lerp(rig.blinkR, bs.eyeBlinkRight || 0, kFace);
        rig.jaw = lerp(rig.jaw, Math.min(1, (bs.jawOpen || 0) * 1.5), kFace);
        rig.browUp = lerp(rig.browUp, bs.browInnerUp || 0, kFace);
        rig.browDown = lerp(rig.browDown, Math.max(bs.browDownLeft || 0, bs.browDownRight || 0), kFace);
        rig.smile = lerp(rig.smile, Math.max(bs.mouthSmileLeft || 0, bs.mouthSmileRight || 0), kFace);
        rig.pucker = lerp(rig.pucker, bs.mouthPucker || 0, kFace);
      }
      if (fr.facialTransformationMatrixes && fr.facialTransformationMatrixes.length) {
        const m = fr.facialTransformationMatrixes[0].data;
        // yaw/roll straight from the rotation matrix (already mirrored input)
        rig.headYaw = lerp(rig.headYaw, Math.atan2(m[8], m[10]), kFace);
        rig.headRoll = lerp(rig.headRoll, Math.atan2(m[1], m[5]), kFace);
        rig.headPitch = lerp(rig.headPitch, Math.asin(Math.max(-1, Math.min(1, -m[9]))), kFace);
      }
    } catch (_) { rig.tracking.face = false; }

    /* ---- POSE (every frame — suit region classification + emblem) ---- */
    try {
      const pr = this.pose.detectForVideo(this.canvas, now);
      const nl = pr.landmarks && pr.landmarks[0];
      if (nl && nl.length >= 29) {
        rig.tracking.pose = true;
        pts.pose.ok = lerp(pts.pose.ok, 1, kBody);
        if (!pts.pose.lm) pts.pose.lm = nl.map((p) => ({ x: p.x, y: p.y, v: p.visibility != null ? p.visibility : 1 }));
        else nl.forEach((p, i) => {
          const s = pts.pose.lm[i];
          s.x = lerp(s.x, p.x, kPos); s.y = lerp(s.y, p.y, kPos);
          s.v = lerp(s.v, p.visibility != null ? p.visibility : 1, kBody);
        });
        // background parallax follows you
        const cx = (nl[11].x + nl[12].x) / 2;
        rig.root.x = lerp(rig.root.x, (cx - 0.5) * 2, kBody);
        const sw = Math.abs(nl[11].x - nl[12].x);
        if (sw > 0.02) rig.root.z = lerp(rig.root.z, Math.max(-1, Math.min(1, (sw / 0.3 - 1))), kBody * 0.5);
      } else {
        rig.tracking.pose = false;
        pts.pose.ok = lerp(pts.pose.ok, 0, kBody * 0.5);
      }
    } catch (_) { rig.tracking.pose = false; }

    /* ---- HANDS (every frame — real gloved fingers glued to yours) ---- */
    try {
      const hr = this.hand.detectForVideo(this.canvas, now + 1);
      const found = hr.landmarks || [];
      // match each detected hand to the nearest previously tracked slot (wrist distance)
      // so a hand never "jumps" between slots frame-to-frame
      const claimed = [false, false];
      const assign = new Array(found.length).fill(-1);
      found.forEach((lm, fi) => {
        let bestSlot = -1, bestD = 1e9;
        for (let s = 0; s < 2; s++) {
          if (claimed[s]) continue;
          const slot = pts.hands.list[s];
          const d = slot.lm ? Math.hypot(slot.lm[0].x - lm[0].x, slot.lm[0].y - lm[0].y) : 0.35 + s * 0.01;
          if (d < bestD) { bestD = d; bestSlot = s; }
        }
        if (bestSlot >= 0) { claimed[bestSlot] = true; assign[fi] = bestSlot; }
      });
      for (let s = 0; s < 2; s++) {
        const fi = assign.indexOf(s);
        const slot = pts.hands.list[s];
        if (fi >= 0) {
          const lm = found[fi];
          slot.ok = lerp(slot.ok, 1, kBody);
          if (!slot.lm) slot.lm = lm.map((p) => ({ x: p.x, y: p.y }));
          else lm.forEach((p, i) => { const q = slot.lm[i]; q.x = lerp(q.x, p.x, kPos); q.y = lerp(q.y, p.y, kPos); });
        } else {
          slot.ok = lerp(slot.ok, 0, kBody);
        }
      }
    } catch (_) { pts.hands.list.forEach((s) => { s.ok = lerp(s.ok, 0, kBody); }); }

    /* ---- SEGMENTATION (every frame, small input — cuts you out of the room) ---- */
    try {
      this.segCtx.drawImage(this.canvas, 0, 0, SEG_W, SEG_H);
      const res = this.seg.segmentForVideo(this.segCanvas, now);
      const mask = res.confidenceMasks && res.confidenceMasks[0];
      if (mask) {
        const fresh = mask.getAsFloat32Array();
        // temporal blend: the matte edge stops flickering frame-to-frame
        if (pts.seg.data && pts.seg.data.length === fresh.length) {
          const prev = pts.seg.data;
          for (let i = 0; i < fresh.length; i++) fresh[i] = prev[i] * 0.38 + fresh[i] * 0.62;
        }
        pts.seg.data = fresh;
        pts.seg.w = mask.width; pts.seg.h = mask.height;
        pts.seg.version++;
        pts.seg.ok = true;
        mask.close();
      }
      rig.tracking.hands = pts.seg.ok; // telemetry slot reused for the matte
    } catch (_) { pts.seg.ok = false; rig.tracking.hands = false; }
  }

  simTick(t, dt) {
    // no camera -> no person to suit up; keep telemetry alive so the UI works
    const rig = this.rig;
    const k = 1 - Math.exp(-dt * 8);
    rig.tracking.face = rig.tracking.pose = rig.tracking.hands = true;
    rig.root.x = lerp(rig.root.x, 0.3 * Math.sin(t * 0.25), k);
    const talking = (Math.sin(t * 0.32) > -0.4) ? 1 : 0;
    rig.jaw = lerp(rig.jaw, talking * Math.max(0, 0.45 * Math.sin(t * 9.1) + 0.3), 0.5);
    rig.level = lerp(rig.level, rig.jaw * 0.8, 0.4);
  }

  dispose() {
    this.running = false;
    try {
      if (this.stream) this.stream.getTracks().forEach((tr) => tr.stop());
      if (this.face) this.face.close(); if (this.pose) this.pose.close(); if (this.seg) this.seg.close();
      if (this.hand) this.hand.close();
    } catch (_) {}
  }
}

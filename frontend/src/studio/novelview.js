/* 2.5D NOVEL VIEW — Ω.3

   Every still becomes a moving shot.

   A frozen frame (a matted performance frame, a synthetic render, any still) is
   turned into REAL GEOMETRY: a depth map is estimated from the image, a dense
   plane is displaced along it, and a true dolly moves through the result with
   correct-feeling parallax and occlusion — not a Ken Burns pan.

   Honest engineering, stated plainly: the gated upgrade here is Depth Anything V2
   (ONNX, WebGPU). Until that gate opens, depth is estimated with a deterministic
   monocular heuristic tuned for this studio's frames — luminance (worlds here are
   dark space, lit subjects read near), a vertical ground prior (lower is closer),
   and a centre prior (the subject is staged centre-frame) — box-blurred so the
   relief reads as surfaces, not noise. Same still + same seed = same mesh, forever.

   Storage is references-only, like everything in the Vault: a still persists as a
   compressed data URL inside the shot; the depth mesh is re-derived on load,
   deterministically, so a `.veylep` containing a STILL shot stays small and
   re-renders identically. */

import * as THREE from 'three';

export const STILL_W = 540;
export const STILL_H = 960;
const SEG_X = 72;
const SEG_Y = 128;
const RELIEF = 0.85;           // metres of depth relief across the frame

/** freeze the current viewport into a persistable still reference */
export function captureStill(sourceCanvas, { seed = 11 } = {}) {
  const c = document.createElement('canvas');
  c.width = STILL_W; c.height = STILL_H;
  const ctx = c.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0, STILL_W, STILL_H);
  return {
    kind: 'still',
    src: c.toDataURL('image/jpeg', 0.85),
    w: STILL_W, h: STILL_H, seed,
    createdAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* deterministic monocular depth heuristic                              */

function estimateDepth(img) {
  const c = document.createElement('canvas');
  c.width = SEG_X + 1; c.height = SEG_Y + 1;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, SEG_X + 1, SEG_Y + 1);
  const px = ctx.getImageData(0, 0, SEG_X + 1, SEG_Y + 1).data;

  const W = SEG_X + 1, H = SEG_Y + 1;
  const d = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const lum = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
      const ground = y / (H - 1);                                  // lower rows are closer
      const cx = (x / (W - 1)) - 0.5;
      const centre = 1 - Math.min(1, Math.abs(cx) * 2.4);          // subject is staged centre
      d[y * W + x] = lum * 0.58 + ground * 0.27 + centre * lum * 0.15;
    }
  }
  /* two box-blur passes: relief must read as surfaces, not per-pixel noise */
  const tmp = new Float32Array(W * H);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
        s += d[yy * W + xx]; n++;
      }
      tmp[y * W + x] = s / n;
    }
    d.set(tmp);
  }
  /* normalize to the full 0..1 range so every still uses its whole relief budget */
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < d.length; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
  const span = Math.max(1e-4, hi - lo);
  for (let i = 0; i < d.length; i++) d[i] = (d[i] - lo) / span;
  return d;
}

/* ------------------------------------------------------------------ */

/**
 * Rebuild the depth mesh from a persisted still reference. Async only because
 * the image decodes; everything after decode is deterministic.
 * Returns { group, dispose } — a plane sized to fill a fov-34 camera at z≈3.
 */
export function createNovelView(still) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const depth = estimateDepth(img);
      const W = SEG_X + 1;

      /* plane sized so the still fills the frame at the dolly's start distance,
         with margin so parallax never exposes the frame edge */
      const dist = 3.0, fov = 34;
      const planeH = 2 * dist * Math.tan((fov * Math.PI) / 360) * 1.22;
      const planeW = planeH * (9 / 16);

      const geo = new THREE.PlaneGeometry(planeW, planeH, SEG_X, SEG_Y);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const gx = i % W;
        const gy = Math.floor(i / W);
        pos.setZ(i, depth[gy * W + gx] * RELIEF);
      }
      geo.computeVertexNormals();

      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      const mat = new THREE.MeshBasicMaterial({ map: tex });
      const mesh = new THREE.Mesh(geo, mat);

      const group = new THREE.Group();
      group.add(mesh);
      /* centre the relief so the dolly orbits inside it, not in front of it */
      mesh.position.set(0, planeH / 2 - 0.15, -RELIEF * 0.5);

      resolve({
        group,
        planeH,
        dispose() { geo.dispose(); mat.dispose(); tex.dispose(); },
      });
    };
    img.onerror = reject;
    img.src = still.src;
  });
}

/**
 * The dolly for a still shot — a pure function of progress u and seed, like every
 * camera rig in the Omega Stage: slow push through the relief with lateral drift.
 */
export function stillCamera(u, planeH, seed = 11) {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  const dir = (s - Math.floor(s)) > 0.5 ? 1 : -1;
  return {
    pos: [dir * (0.22 - u * 0.34), planeH / 2 - 0.15 + (u - 0.5) * 0.10, 3.0 - u * 0.85],
    look: [dir * (u - 0.5) * -0.08, planeH / 2 - 0.15, -RELIEF * 0.5],
    fov: 34 - u * 2.5,
  };
}

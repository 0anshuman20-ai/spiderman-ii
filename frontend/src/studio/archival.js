/* THE ARCHIVAL SOURCE — Ω.6

   The hybrid cut: real footage as a first-class shot source. An imported clip
   becomes a video plane in its own render graph and is pushed through the SAME
   composer chain — bloom, horror grade, cinema finish — that every synthetic
   shot rides. That shared grade is the whole trick of hybrid editing: archival
   plates and rendered shots stop looking like two different movies.

   Honest by design, like every other source in this studio:
   - the source badge derives from the data (`shot.footage` ⇒ ARCHIVAL) and is
     burned into the frame when badges are on — real frames are labelled real
     with exactly the same machinery that labels synthetic frames synthetic.
   - the clip persists INSIDE the shot as a data URL, so a `.veylep` that cuts
     archival material re-renders identically on any machine, forever.

   The rostrum camera (footageCamera) is a seeded, deterministic push-in over
   the plate — the classic archival-documentary move — and the shared handheld
   drift sits on top, so the plate never reads as a static screenshot. */
import * as THREE from 'three';

/* one clip per shot, embedded in the episode file — keep it honest and portable */
const MAX_FOOTAGE_BYTES = 48 * 1024 * 1024;
const MAX_FOOTAGE_DUR = 12;

/* seeded scalar in [0,1) — same hash family as the handheld rig */
const sHash = (seed, n) => {
  const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** read a user video file into a persistable footage reference: {kind, src, dur, w, h, seed, name} */
export function importFootage(file, seed = 11) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type).startsWith('video/')) {
      reject(new Error('archival source must be a video file')); return;
    }
    if (file.size > MAX_FOOTAGE_BYTES) {
      reject(new Error('clip too large — keep archival footage under 48 MB')); return;
    }
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('could not read the file'));
    fr.onload = () => {
      const src = fr.result;
      /* probe the clip: an undecodable plate is rejected at import, never at render */
      const probe = document.createElement('video');
      probe.muted = true; probe.preload = 'metadata'; probe.src = src;
      probe.onloadedmetadata = () => {
        const dur = Math.max(0.5, Math.min(MAX_FOOTAGE_DUR, probe.duration || 4));
        resolve({
          kind: 'footage', src, dur,
          w: probe.videoWidth || 0, h: probe.videoHeight || 0,
          seed, name: (file.name || 'plate').replace(/\.[^.]+$/, ''),
        });
      };
      probe.onerror = () => reject(new Error('undecodable video — try mp4/webm'));
    };
    fr.readAsDataURL(file);
  });
}

/** the rostrum move: seeded slow push-in + lateral drift over the plate.
    Pure function of (u, planeH, seed) — deterministic, seekable, re-renderable. */
export function footageCamera(u, planeH, seed = 11) {
  const fov = 34;
  const fit = (planeH / 2) / Math.tan((fov / 2) * (Math.PI / 180));
  const push = 0.10 + sHash(seed, 1) * 0.06;          // 10–16% push over the shot
  const dx = (sHash(seed, 2) - 0.5) * planeH * 0.05;  // where the push settles
  const dy = (sHash(seed, 3) - 0.5) * planeH * 0.035;
  const e = u * u * (3 - 2 * u);                       // smoothstep ease
  return {
    pos: [dx * e, dy * e, fit * (1.045 - push * e)],
    look: [dx * e, dy * e, 0],
    fov,
  };
}

/** decode the clip into a video-textured plane living in its own scene graph.
    Resolves like createNovelView: { group, planeH, video, syncTo, play, pause, dispose } */
export function createFootageView(footage) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.loop = false;
    video.preload = 'auto';
    video.src = footage.src;

    const onReady = () => {
      const tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      const aspect = (video.videoWidth || footage.w || 16) / (video.videoHeight || footage.h || 9);
      const planeH = 2.4;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(planeH * aspect, planeH),
        new THREE.MeshBasicMaterial({ map: tex }),
      );
      const group = new THREE.Group();
      group.add(mesh);
      resolve({
        group, planeH, video,
        /* drift-corrected sync: seek only when the plate has fallen out of step,
           so scrubbing is exact and playback never thrashes the decoder */
        syncTo(t) {
          const end = Math.max(0, (video.duration || footage.dur) - 0.05);
          const target = Math.max(0, Math.min(end, t));
          if (video.paused || Math.abs(video.currentTime - target) > 0.28) {
            try { video.currentTime = target; } catch (_) { /* seek unavailable mid-decode */ }
          }
        },
        play() { video.play().catch(() => { /* autoplay veto: syncTo still drives the plate */ }); },
        pause() { video.pause(); },
        dispose() {
          video.pause();
          video.removeAttribute('src');
          try { video.load(); } catch (_) { /* detached */ }
          tex.dispose();
          mesh.geometry.dispose();
          mesh.material.dispose();
        },
      });
    };
    video.addEventListener('loadeddata', onReady, { once: true });
    video.addEventListener('error', () => reject(new Error('undecodable footage')), { once: true });
    video.load();
  });
}

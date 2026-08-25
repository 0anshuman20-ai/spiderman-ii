/* THE GATE — RECOVERY 1.3 + RECOVERY 2 #4.

   Two falsifiable checks, both pre-committed by memory/RECOVERY_PLAN.md, both
   blocking: Phase 3 (the re-doored Sun Signal upload) does not start until the
   freeze-frame test passes, and no two consecutive uploads may share a first
   frame the feed can't tell apart (2026 YPP demonetizes template-repetitive
   channels — the fingerprint rule is a POLICY requirement, not taste).

   1) FIRST-FRAME FINGERPRINT — 64-bit dHash of every candidate first frame.
      Hamming distance between CONSECUTIVE uploads must exceed DOOR_MIN_DIST.
      dHash (gradient hash) over aHash because it is robust to the exposure and
      grade shifts between takes while still collapsing "same composition,
      different noise" — exactly the failure mode of 7 near-identical doors.

   2) FREEZE-FRAME TEST — 5 pipeline renders shuffled against 5 real NASA
      public-domain stills, each flashed for exactly 1 second (the feed's
      pre-attentive window is 400-500ms; 1s is generous to the render). The
      tester calls REAL or FAKE per still. PASS = at least 2 of the 5 renders
      misidentified as real. The plan asks for 3 testers; the ledger keeps
      every run and the gate opens on the plan's rule, not on mood.

   Results are a few bytes of JSON — the render ledger pattern (omega.js),
   localStorage, never media. */

const GATE_KEY = 'veyl-gate-v1';

/* the plan's threshold: distance in bits (of 64) two consecutive first frames
   must exceed to count as "distinguishable at thumbnail size". 10/64 ≈ 16% of
   bits — well past JPEG/re-render noise (~2-4 bits), well short of demanding a
   different genre every upload. */
export const DOOR_MIN_DIST = 10;

/* PASS rule from RECOVERY 1.3: at least 2 of 5 renders misidentified as real */
export const RENDERS_PER_RUN = 5;
export const PASS_MIN_FOOLED = 2;

/* ------------------------------------------------------------------ */
/* dHash: 9x8 grayscale, each bit = "is this pixel brighter than its right
   neighbour". 64 bits, packed as 16 hex chars. Source: any drawable
   (HTMLImageElement, HTMLCanvasElement, ImageBitmap, video frame). */
export function dhash(source, w = 9, h = 8) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    lum[i] = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
  }
  let hex = '';
  let nibble = 0, bits = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      nibble = (nibble << 1) | (lum[y * w + x] > lum[y * w + x + 1] ? 1 : 0);
      bits++;
      if (bits === 4) { hex += nibble.toString(16); nibble = 0; bits = 0; }
    }
  }
  return hex; // 16 hex chars = 64 bits
}

/** Hamming distance between two hex hashes (bits that differ, 0..64) */
export function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

/** decode a File/Blob into an <img> ready for dhash() */
export function decodeImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('undecodable image')); };
    img.src = url;
  });
}

/** RECOVERY 2 #4 — the fingerprint rule over an ORDERED upload list.
    Every consecutive pair below DOOR_MIN_DIST is a violation: the feed (and
    the 2026 YPP repetition policy) reads them as one video reposted. */
export function fingerprintReport(entries) {
  const pairs = [];
  for (let i = 1; i < entries.length; i++) {
    const dist = hamming(entries[i - 1].hash, entries[i].hash);
    pairs.push({ a: entries[i - 1].label, b: entries[i].label, dist, ok: dist >= DOOR_MIN_DIST });
  }
  return { pairs, violations: pairs.filter((p) => !p.ok).length, pass: pairs.length > 0 && pairs.every((p) => p.ok) };
}

/* ------------------------------------------------------------------ */
/* the freeze-frame deck: 5 renders + 5 reals, seeded Fisher-Yates so a run is
   reproducible from its seed (every gate number must be re-derivable) */
export function buildDeck(renders, reals, seed = Date.now() % 100000) {
  const cards = [
    ...renders.slice(0, RENDERS_PER_RUN).map((r) => ({ ...r, kind: 'render' })),
    ...reals.slice(0, RENDERS_PER_RUN).map((r) => ({ ...r, kind: 'real' })),
  ];
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return { seed, cards };
}

/** score one tester's run. answers[i] = 'real' | 'fake' for deck.cards[i].
    fooled = renders the tester called REAL (the number the plan reads). */
export function scoreRun(deck, answers) {
  let fooled = 0, realsCaught = 0, renders = 0, reals = 0;
  deck.cards.forEach((card, i) => {
    if (card.kind === 'render') { renders++; if (answers[i] === 'real') fooled++; }
    else { reals++; if (answers[i] === 'real') realsCaught++; }
  });
  return { fooled, renders, realsCaught, reals, pass: fooled >= PASS_MIN_FOOLED };
}

/* ------------------------------------------------------------------ */
/* gate ledger */
export function readGate() {
  try { return JSON.parse(localStorage.getItem(GATE_KEY)) || { runs: [] }; } catch (_) { return { runs: [] }; }
}

export function saveRun(run) {
  const g = readGate();
  g.runs.push({ ...run, at: Date.now() });
  /* the plan's panel is 3 people — the gate opens on a MAJORITY of passing
     runs (2), and stays open: a later failed run adds information but cannot
     re-lock a phase already entered */
  const passing = g.runs.filter((r) => r.pass).length;
  if (passing >= 2 && !g.passedAt) g.passedAt = Date.now();
  try { localStorage.setItem(GATE_KEY, JSON.stringify(g)); } catch (_) { /* storage unavailable */ }
  return g;
}

export function clearGate() {
  try { localStorage.removeItem(GATE_KEY); } catch (_) { /* storage unavailable */ }
}

/** Phase 3 lock state, straight from the plan: "Until this passes, Phase 3
    does not start." */
export function gateOpen() {
  return Boolean(readGate().passedAt);
}

/* ------------------------------------------------------------------ */
/* PHASE A5 — v3 additions. Three instruments, all pre-committed by
   memory/RECOVERY_PLAN.md §2 #6 + Phase C #2:

   1) LOOP SEAM CHECK (same take): first vs last frame must be SIMILAR —
      the exact inverse of the cross-upload rule. dist < DOOR_MIN_DIST is
      how the feed decides "same picture"; the seam WANTS that read, so it
      passes where the cross-upload rule would fail. SEAM_MAX_DIST is a
      little looser (the frame-zero burn text and grain flip a few bits).
   2) DOOR PAIRING WARNING (cross upload): consecutive planned uploads that
      share BOTH worldKey and doorMove are pre-flagged BEFORE recording —
      the dHash rule would only catch them after the takes exist.
   3) PRE-PUBLISH CHECKLIST (Phase C #2): enforced in the gate, not
      remembered. Persisted per-attempt in localStorage; publish verdict is
      ALL boxes, no override. */

export const SEAM_MAX_DIST = 16;

/** same-take loop-seam verdict: last frame ≈ first frame (v3 corr. 2) */
export function seamReport(firstHash, lastHash) {
  const dist = hamming(firstHash, lastHash);
  return { dist, ok: dist <= SEAM_MAX_DIST };
}

/** decode a take (video File/Blob), dHash its first and last frames.
    Seeks are event-driven — works on WebM out of the studio recorder. */
export function hashVideoEnds(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const fail = (msg) => { URL.revokeObjectURL(url); reject(new Error(msg)); };
    const grab = () => {
      try { return dhash(video); } catch (err) { fail('frame unreadable'); return null; }
    };
    let firstHash = null;
    video.onerror = () => fail('undecodable video');
    video.onloadedmetadata = () => {
      /* MediaRecorder WebM often reports Infinity until seeked past the end —
         the standard workaround: seek far, duration resolves, then start over */
      if (!Number.isFinite(video.duration)) { video.currentTime = 1e9; return; }
      video.currentTime = 0.001;
    };
    video.onseeked = () => {
      if (!Number.isFinite(video.duration)) return; // still resolving
      if (video.currentTime > video.duration - 0.2 && firstHash === null && video.currentTime > 1) {
        /* this was the duration-resolving seek — rewind to the real start */
        video.currentTime = 0.001;
        return;
      }
      if (firstHash === null) {
        firstHash = grab();
        if (firstHash === null) return;
        video.currentTime = Math.max(0, video.duration - 0.05);
        return;
      }
      const lastHash = grab();
      if (lastHash === null) return;
      const duration = video.duration;
      URL.revokeObjectURL(url);
      resolve({ firstHash, lastHash, duration, ...seamReport(firstHash, lastHash) });
    };
    video.src = url;
  });
}

/** RECOVERY 2 #6 — pre-flag consecutive planned uploads sharing BOTH
    worldKey and doorMove. entries: [{ label, world, doorMove }] in
    publish order. */
export function pairingReport(entries) {
  const pairs = [];
  for (let i = 1; i < entries.length; i++) {
    const a = entries[i - 1];
    const b = entries[i];
    const shared = a.world === b.world && a.doorMove === b.doorMove;
    pairs.push({ a: a.label, b: b.label, world: b.world, doorMove: b.doorMove, ok: !shared });
  }
  return { pairs, violations: pairs.filter((p) => !p.ok).length, pass: pairs.every((p) => p.ok) };
}

/* PHASE C #2 — the checklist, verbatim from the plan. Ordered; ids stable
   (the ledger stores ids, so rewording an item never un-checks it). */
export const PRE_PUBLISH_CHECKLIST = [
  { id: 'burn-legible', text: 'Burned hook text legible at 360px width' },
  { id: 'word-half-sec', text: 'First spoken word ≤ 0.5s; audio at t=0' },
  { id: 'runtime-25', text: 'Runtime ≤ 25s' },
  { id: 'seam-verified', text: 'Loop seam verified by scrubbing (last frame ≈ first frame)' },
  { id: 'ip-labels', text: 'Fan-made parody label + AI disclosure flag set' },
  { id: 'no-command-cta', text: 'No command-phrased CTA anywhere' },
  { id: 'title-not-hook', text: 'Title is not the hook text verbatim (no redundancy tax)' },
  { id: 'plays-outside', text: 'File plays outside the browser' },
];

const CHECKLIST_KEY = 'veyl-prepublish-v1';

export function readChecklist() {
  try { return JSON.parse(localStorage.getItem(CHECKLIST_KEY)) || {}; } catch (_) { return {}; }
}

export function toggleChecklist(id) {
  const c = readChecklist();
  c[id] = !c[id];
  try { localStorage.setItem(CHECKLIST_KEY, JSON.stringify(c)); } catch (_) { /* storage unavailable */ }
  return c;
}

export function resetChecklist() {
  try { localStorage.removeItem(CHECKLIST_KEY); } catch (_) { /* storage unavailable */ }
  return {};
}

/** publish verdict: every box, no override */
export function checklistClear(state) {
  return PRE_PUBLISH_CHECKLIST.every((item) => Boolean(state[item.id]));
}

/* the 5 real NASA public-domain stills shipped with the app (public/gate/) */
export const REAL_STILLS = [
  { src: '/gate/real-earthrise.jpg', label: 'APOLLO 8 — EARTHRISE' },
  { src: '/gate/real-sun-sdo.jpg', label: 'SDO — SOLAR FLARE' },
  { src: '/gate/real-iss.jpg', label: 'ISS — CUPOLA' },
  { src: '/gate/real-nebula.jpg', label: 'SPITZER — CALIFORNIA NEBULA' },
  { src: '/gate/real-mars.jpg', label: 'MARS — JEZERO' },
];

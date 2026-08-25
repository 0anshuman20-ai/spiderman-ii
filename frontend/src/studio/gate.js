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

/* the 5 real NASA public-domain stills shipped with the app (public/gate/) */
export const REAL_STILLS = [
  { src: '/gate/real-earthrise.jpg', label: 'APOLLO 8 — EARTHRISE' },
  { src: '/gate/real-sun-sdo.jpg', label: 'SDO — SOLAR FLARE' },
  { src: '/gate/real-iss.jpg', label: 'ISS — CUPOLA' },
  { src: '/gate/real-nebula.jpg', label: 'SPITZER — CALIFORNIA NEBULA' },
  { src: '/gate/real-mars.jpg', label: 'MARS — JEZERO' },
];

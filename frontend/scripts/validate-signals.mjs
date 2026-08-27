#!/usr/bin/env node
/* =============================================================================
   validate-signals.mjs — DEV TOOL, NOT SHIPPED.

   Makes "the scripts pass the gate" a checkable fact instead of something
   eyeballed. Encodes the parts of VIRAL_RULES / RETENTION_CHECKLIST that are
   mechanically decidable, and says nothing about the parts that are not (voice,
   dread, whether a metaphor lands). Those still need a human.

   Usage
     node scripts/validate-signals.mjs             # all signals
     node scripts/validate-signals.mjs 16-23       # only that id range
     node scripts/validate-signals.mjs 17          # one signal
     node scripts/validate-signals.mjs --strict 16-23   # exit 1 on WARN too

   Loading note: src/studio/scripts.js is ESM but the package has no
   "type": "module", so node would parse it as CommonJS and throw on `export`.
   It has zero imports, so the whole file is handed to the loader as a data: URL
   module instead — always ESM, no build step, no copy of the data that can
   drift out of sync with the real file.
   ========================================================================== */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_PATH = resolve(HERE, '../src/studio/scripts.js');

/* ---------------------------------------------------------------- doctrine */
const WORDS_PER_SEC = 2.5;   // doctrine delivery rate
const RUNTIME_TOL = 0.15;    // +/-15% of durationSec
const BEATS_EXPECTED = 6;
const MAX_SENTENCE_WORDS = 10;
const MAX_HOOK_WORDS = 7;
const MAX_FRAME_ZERO_WORDS = 4;
const MAX_LOOPLINE_WORDS = 18;
const TWIST_WINDOW = [8, 14];      // the "wait, WHAT" must sit at the midpoint
const MICRO_6 = [5, 7];            // defibrillator 1
const MICRO_17 = [15, 17.5];       // defibrillator 3
const LIKE_CTA_WINDOW = [10, 12];
const ANCHOR_BEATS = 2;            // beat 1 or 2 must name the subject

/* Words that carry no subject meaning, so they cannot count as the plain
   language anchor. Without this, "the" in factCheck matches everything. */
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'by',
  'for', 'with', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'it',
  'its', 'this', 'that', 'these', 'those', 'you', 'your', 'we', 'our', 'they',
  'their', 'not', 'no', 'never', 'all', 'any', 'some', 'most', 'more', 'than',
  'then', 'so', 'via', 'per', 'about', 'into', 'over', 'out', 'up', 'down',
  'one', 'two', 'three', 'first', 'every', 'each', 'can', 'could', 'would',
  'will', 'may', 'might', 'must', 'has', 'have', 'had', 'do', 'does', 'did',
  'real', 'live', 'high', 'low', 'new', 'old', 'long', 'term', 'time', 'times',
  'here', 'there', 'when', 'while', 'what', 'which', 'who', 'how', 'why',
  'data', 'facts', 'fact', 'thing', 'things', 'much', 'many', 'very', 'also',
  /* generic descriptors that appear in the factChecks but never identify the
     subject — they must not be able to satisfy the anchor on their own */
  'hard', 'harder', 'step', 'steps', 'visible', 'position', 'unknown',
  'known', 'common', 'rare', 'possible', 'likely', 'roughly', 'about',
  'above', 'below', 'before', 'after', 'during', 'because', 'though',
  'still', 'again', 'almost', 'nearly', 'other', 'others', 'another',
  'called', 'named', 'labeled', 'called', 'means', 'meaning', 'scenario',
  'scenarios', 'hypothesis', 'hypotheses', 'evidence', 'observed',
]);

const words = (s) => String(s).trim().split(/\s+/).filter(Boolean);
const wordCount = (s) => words(s).length;

/* Split spoken text into sentences. Only . ! ? terminate — the scripts use
   em dashes and commas heavily inside single spoken sentences. */
const sentences = (s) =>
  String(s).split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);

/* Bare alphabetic stem so "civilizations" matches "civilization" and
   "pulsars" matches "pulsar". PLURALS ONLY, deliberately.
   An earlier version also stripped -ions/-ing, which made it inconsistent in
   exactly the case that matters: "civilizations" became "civilizat" while
   "civilization" stayed whole, so the two never matched and the anchor check
   silently missed. Collapsing only the plural keeps both sides identical. */
const stem = (w) => {
  const s = w.toLowerCase().replace(/[^a-z]/g, '');
  if (s.length < 4) return s;
  if (s.endsWith('ies')) return `${s.slice(0, -3)}y`;
  if (s.endsWith('sses')) return s.slice(0, -2);
  if (s.endsWith('es') && !s.endsWith('ses')) return s.slice(0, -1);
  if (s.endsWith('s') && !s.endsWith('ss') && !s.endsWith('us')) return s.slice(0, -1);
  return s;
};

const near = (v, [lo, hi]) => v >= lo && v <= hi;

/* ------------------------------------------------------------------ checks */
function validateSignal(sig) {
  const errors = [];
  const warns = [];
  const E = (m) => errors.push(m);
  const W = (m) => warns.push(m);

  const beats = Array.isArray(sig.beats) ? sig.beats : [];

  /* --- structure: 6 beats on the doctrine grid --------------------------- */
  if (beats.length !== BEATS_EXPECTED) {
    E(`${beats.length} beats, expected ${BEATS_EXPECTED} (5-beat scripts leave the ~6s and ~17s micro-hooks unscripted)`);
  }
  if (!beats.length) return { errors, warns };

  if (beats[0].t !== 0) E(`first beat at t=${beats[0].t}, must be 0 (frame zero is spoken, not empty)`);

  for (let i = 1; i < beats.length; i++) {
    if (beats[i].t <= beats[i - 1].t) {
      E(`beat ${i} at t=${beats[i].t} does not advance past beat ${i - 1} at t=${beats[i - 1].t}`);
    }
  }

  const ts = beats.map((b) => b.t);
  if (!ts.some((t) => near(t, MICRO_6))) W(`no beat near ~6s (have ${ts.join(', ')}) — micro-hook 1 has nothing to land on`);
  if (!ts.some((t) => near(t, MICRO_17))) W(`no beat near ~16-17s (have ${ts.join(', ')}) — the tail is dead air before the loop`);

  /* --- the twist sits at the midpoint, never at the end ------------------ */
  const twist = beats.find((b) => /twist/i.test(b.note || ''));
  if (!twist) {
    W('no beat note marks the TWIST — cannot verify it sits at 8-14s');
  } else if (!near(twist.t, TWIST_WINDOW)) {
    E(`TWIST at ${twist.t}s is outside ${TWIST_WINDOW[0]}-${TWIST_WINDOW[1]}s (an end-loaded twist plays to an empty room)`);
  }

  /* --- sentence length, hook, burned-in text ----------------------------- */
  beats.forEach((b, i) => {
    sentences(b.text).forEach((s) => {
      const n = wordCount(s);
      if (n > MAX_SENTENCE_WORDS) E(`beat ${i} (t=${b.t}) sentence is ${n} words (max ${MAX_SENTENCE_WORDS}): "${s}"`);
    });
  });

  if (!sig.hook) E('no spoken hook');
  else if (wordCount(sig.hook) > MAX_HOOK_WORDS) E(`hook is ${wordCount(sig.hook)} words (max ${MAX_HOOK_WORDS}): "${sig.hook}"`);

  if (!sig.frameZero) E('no frameZero burned-in text');
  else if (wordCount(sig.frameZero) > MAX_FRAME_ZERO_WORDS) E(`frameZero is ${wordCount(sig.frameZero)} words (max ${MAX_FRAME_ZERO_WORDS}): "${sig.frameZero}"`);

  /* The doctrine wants TWO open loops: the burned-in text and the spoken hook
     must not be the same words. */
  if (sig.hook && sig.frameZero) {
    const a = sig.frameZero.toLowerCase().replace(/[^a-z ]/g, '').trim();
    const b = sig.hook.toLowerCase().replace(/[^a-z ]/g, '').trim();
    if (a && b.includes(a)) W(`frameZero "${sig.frameZero}" is contained in the spoken hook — one open loop where there should be two`);
  }

  /* --- runtime budget ---------------------------------------------------- */
  /* Beats only. The loop line overlaps the tail and the loop point, so it is
     budgeted separately by its own word cap rather than added here. */
  const spoken = beats.reduce((n, b) => n + wordCount(b.text), 0);
  const secs = spoken / WORDS_PER_SEC;
  const lo = sig.durationSec * (1 - RUNTIME_TOL);
  const hi = sig.durationSec * (1 + RUNTIME_TOL);
  if (secs < lo || secs > hi) {
    E(`${spoken} spoken words = ${secs.toFixed(1)}s at ${WORDS_PER_SEC} w/s, outside ${lo.toFixed(1)}-${hi.toFixed(1)}s for a ${sig.durationSec}s runtime`);
  }

  /* --- the plain language anchor ---------------------------------------- */
  /* RETENTION_CHECKLIST: "Is the real subject NAMED OUT LOUD, in plain words,
     before 5s?" Checked as: some meaningful word from factCheck appears in
     beat 1 or 2. Crude, but it reliably catches the Signal 17 failure mode
     where the audio never once says what the thing is. */
  if (!sig.factCheck) {
    W('no factCheck, cannot verify the plain-language anchor');
  } else {
    /* Length > 4, not just > 3. At > 3 the check passed on incidental
       adjectives: Signal 17 "cleared" this gate on the word "hard" (from
       "grades hard" vs factCheck "a hard step") while never once saying
       "Great Filter" — the exact failure the gate exists to catch. Subject
       nouns in these factChecks are 5+ characters essentially without
       exception, so the shorter words are noise. */
    const subject = new Set(
      words(sig.factCheck)
        .map(stem)
        .filter((w) => w.length > 4 && !STOP.has(w)),
    );
    const anchorText = beats.slice(0, ANCHOR_BEATS).map((b) => b.text).join(' ');
    const spokenStems = new Set(words(anchorText).map(stem));
    const hits = [...subject].filter((w) => spokenStems.has(w));
    if (!hits.length) {
      E(`no word from factCheck is spoken in the first ${ANCHOR_BEATS} beats — the subject is never named out loud (the "they call it the filter" failure)`);
    }
    const anchorBeat = beats[ANCHOR_BEATS - 1];
    if (anchorBeat && anchorBeat.t > 5) {
      W(`beat ${ANCHOR_BEATS} lands at ${anchorBeat.t}s, after the 5s naming deadline`);
    }
  }

  /* --- required engagement furniture ------------------------------------ */
  if (!sig.loopLine) E('no loopLine (the ending belongs to the loop)');
  else {
    const n = wordCount(sig.loopLine);
    if (n > MAX_LOOPLINE_WORDS) E(`loopLine is ${n} words (max ${MAX_LOOPLINE_WORDS}) — it will not fit the tail`);
    sentences(sig.loopLine).forEach((s) => {
      if (wordCount(s) > MAX_SENTENCE_WORDS) E(`loopLine sentence is ${wordCount(s)} words (max ${MAX_SENTENCE_WORDS}): "${s}"`);
    });
  }

  if (!sig.shareTrigger) E('no shareTrigger (shares are the heaviest ranking signal)');
  if (!sig.hiddenFrame) W('no hiddenFrame');

  if (!sig.likeCta || typeof sig.likeCta.atSec !== 'number') {
    E('no likeCta.atSec');
  } else if (!near(sig.likeCta.atSec, LIKE_CTA_WINDOW)) {
    E(`likeCta at ${sig.likeCta.atSec}s, must sit at the twist (${LIKE_CTA_WINDOW[0]}-${LIKE_CTA_WINDOW[1]}s), never at the end`);
  }

  if (!Array.isArray(sig.microHooks) || sig.microHooks.length < 3) {
    W(`microHooks has ${sig.microHooks?.length ?? 0} entries, doctrine wants 3 (~6s, ~12s, ~17s)`);
  }

  if (typeof sig.durationSec !== 'number') E('no durationSec');
  else if (sig.durationSec < 18 || sig.durationSec > 22) E(`durationSec ${sig.durationSec} is outside the 18-22s window`);

  return { errors, warns };
}

/* -------------------------------------------------------------------- main */
const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const rangeArg = argv.find((a) => !a.startsWith('--'));

let lo = -Infinity;
let hi = Infinity;
if (rangeArg) {
  const m = rangeArg.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) {
    console.error(`Bad range "${rangeArg}". Use 17 or 16-23.`);
    process.exit(2);
  }
  lo = Number(m[1]);
  hi = m[2] ? Number(m[2]) : lo;
}

const source = readFileSync(SCRIPTS_PATH, 'utf8');
const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const mod = await import(dataUrl);

const all = mod.SIGNALS ?? [];
if (!all.length) {
  console.error('No SIGNALS exported from src/studio/scripts.js');
  process.exit(2);
}

const selected = all.filter((s) => s.id >= lo && s.id <= hi);
if (!selected.length) {
  console.error(`No signals in range ${rangeArg}. File has ids ${all[0].id}-${all[all.length - 1].id}.`);
  process.exit(2);
}

let failed = 0;
let warned = 0;
const lines = [];

for (const sig of selected) {
  const { errors, warns } = validateSignal(sig);
  if (errors.length) {
    failed++;
    lines.push(`\nFAIL  Signal ${String(sig.id).padStart(2, '0')}  ${sig.title ?? ''}`);
    errors.forEach((e) => lines.push(`      x ${e}`));
    warns.forEach((w) => lines.push(`      ~ ${w}`));
  } else if (warns.length) {
    warned++;
    lines.push(`\nWARN  Signal ${String(sig.id).padStart(2, '0')}  ${sig.title ?? ''}`);
    warns.forEach((w) => lines.push(`      ~ ${w}`));
  }
}

const scope = rangeArg ? `signals ${rangeArg}` : `all ${all.length} signals`;
console.log(`validate-signals — ${scope} (${selected.length} checked)`);
if (lines.length) console.log(lines.join('\n'));

const passed = selected.length - failed - warned;
console.log(`\n${passed} pass, ${warned} warn, ${failed} fail`);

if (failed > 0 || (strict && warned > 0)) process.exit(1);

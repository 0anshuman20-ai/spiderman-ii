/* THE TRIPWIRE TABLE — RECOVERY 3 + 4, executable.

   "Decisions pre-committed, so mood can't make them later."

   This module is the plan's sections 3 and 4 turned into pure functions:
   a ledger of measured uploads (YouTube Studio numbers, entered by hand —
   the studio never pretends to have API access it doesn't), a rolling
   channel-median baseline over the last 20 Shorts (v2 correction #1: there
   is no universal benchmark, only YOUR median), and a deterministic verdict
   for every entry, straight from the tripwire table. Same numbers in, same
   decision out, forever.

   Hard rules encoded here, none negotiable at read time:
   - RECOVERY 3.3: no verdict before 72h. A seed test read early is a lie.
   - RECOVERY 3.4: exactly two numbers are read — stayed-to-watch and AVD.
   - RECOVERY 4: the verdict is looked up, not argued.
   - Rolling baseline: median over the last 20 entries BEFORE the one being
     judged (a test cannot be its own baseline), re-based automatically —
     the plan's "recompute after every 5 uploads" is subsumed by recomputing
     on every read, which is strictly more honest.

   Storage: the render-ledger pattern (gate.js, omega.js) — a few bytes of
   JSON in localStorage, never media. */

const LEDGER_KEY = 'veyl-tripwire-v1';

/* RECOVERY 3.3 — "Wait 72h minimum before reading numbers." */
export const READ_DELAY_H = 72;

/* RECOVERY 0 — the measured baseline this whole plan was derived from.
   These two rows are the only uploads with retention data; they seed the
   ledger so the median exists from day zero and equals the plan's stated
   "channel median ~12%" ((13.9 + 9.4) / 2 = 11.65). Deleting them is
   allowed once real post-recovery data outnumbers them. */
export const MEASURED_BASELINE = [
  {
    id: 'seed-sun', label: 'IF THE SUN DIED (PRE-RECOVERY)',
    publishedAt: Date.parse('2026-08-13T00:00:00Z'),
    views: 943, stayedPct: 13.9, avdSec: 13, lenSec: 28,
    seed: true, note: '119% spike @0:03 — the rewind magnet arriving 3s late',
  },
  {
    id: 'seed-night', label: 'REAL NIGHT SKY (PRE-RECOVERY)',
    publishedAt: Date.parse('2026-08-15T00:00:00Z'),
    views: 222, stayedPct: 9.4, avdSec: 14, lenSec: 27,
    seed: true, note: 'steady bleed — survivors watched half',
  },
];

/* fallback when the ledger holds no measurable history at all */
export const FALLBACK_MEDIAN = 12;

/* practitioner consensus lines from v2 correction #1 (swipe-away in first 3s) */
export const SWIPE_FAIL_PCT = 35;   // above = hook failure
export const SWIPE_HEALTHY_PCT = 25; // below = healthy

/* tripwire ratio lines from the table */
export const RATIO_CONFIRMED = 2.0;
export const RATIO_PARTIAL = 1.3;

/* rolling window */
export const BASELINE_WINDOW = 20;

/* ------------------------------------------------------------------ */
/* ledger */

export function readLedger() {
  try {
    const l = JSON.parse(localStorage.getItem(LEDGER_KEY));
    if (l && Array.isArray(l.entries)) return l;
  } catch (_) { /* corrupt or absent */ }
  return { entries: MEASURED_BASELINE.slice() };
}

function persist(ledger) {
  try { localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger)); } catch (_) { /* storage unavailable */ }
  return ledger;
}

/** log an upload. Numbers may be blank at publish time and filled in after
    the 72h window — the verdict machinery handles both states. */
export function addEntry(entry) {
  const ledger = readLedger();
  ledger.entries.push({
    id: `u-${Date.now().toString(36)}`,
    publishedAt: Date.now(),
    ...entry,
    at: Date.now(),
  });
  /* ledger stays in publish order — the baseline window and the fingerprint
     rule both read consecutive order as meaningful */
  ledger.entries.sort((a, b) => (a.publishedAt || 0) - (b.publishedAt || 0));
  return persist(ledger);
}

export function updateEntry(id, patch) {
  const ledger = readLedger();
  const i = ledger.entries.findIndex((e) => e.id === id);
  if (i >= 0) ledger.entries[i] = { ...ledger.entries[i], ...patch };
  return persist(ledger);
}

export function removeEntry(id) {
  const ledger = readLedger();
  ledger.entries = ledger.entries.filter((e) => e.id !== id);
  return persist(ledger);
}

export function clearLedger() {
  try { localStorage.removeItem(LEDGER_KEY); } catch (_) { /* storage unavailable */ }
  return readLedger();
}

/* ------------------------------------------------------------------ */
/* the rolling baseline — v2 correction #1 */

function median(values) {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** channel median stayed-to-watch over the last BASELINE_WINDOW entries
    strictly BEFORE `beforeId` (or over everything when beforeId is null).
    A test can never be its own baseline. */
export function channelMedian(entries, beforeId = null) {
  let pool = entries;
  if (beforeId) {
    const i = entries.findIndex((e) => e.id === beforeId);
    pool = i >= 0 ? entries.slice(0, i) : entries;
  }
  const vals = pool
    .filter((e) => typeof e.stayedPct === 'number' && isFinite(e.stayedPct))
    .slice(-BASELINE_WINDOW)
    .map((e) => e.stayedPct);
  const m = median(vals);
  return { median: m == null ? FALLBACK_MEDIAN : m, n: vals.length, fallback: m == null };
}

/* ------------------------------------------------------------------ */
/* the verdict — RECOVERY 4, looked up, never argued */

export function hoursSince(publishedAt, now = Date.now()) {
  return (now - (publishedAt || now)) / 3600000;
}

/**
 * Evaluate one entry against the tripwire table.
 * Returns { state, ratio, baseline, action, secondary[] } where state is:
 *   'waiting'   — inside the 72h seed window; the ONLY output is when to read
 *   'unread'    — window elapsed but the two numbers aren't entered yet
 *   'confirmed' | 'partial' | 'failed' — the table's three rows
 */
export function evaluate(entry, entries, now = Date.now()) {
  const { median: base, n, fallback } = channelMedian(entries, entry.id);
  const h = hoursSince(entry.publishedAt, now);

  if (entry.publishedAt && h < READ_DELAY_H) {
    return {
      state: 'waiting', baseline: base, baselineN: n, baselineFallback: fallback,
      readAt: entry.publishedAt + READ_DELAY_H * 3600000,
      action: `SEED RUNNING — DO NOT READ. VERDICT UNLOCKS AT +${READ_DELAY_H}H.`,
      secondary: [],
    };
  }

  if (typeof entry.stayedPct !== 'number' || !isFinite(entry.stayedPct)) {
    return {
      state: 'unread', baseline: base, baselineN: n, baselineFallback: fallback,
      action: 'WINDOW ELAPSED — ENTER STAYED-TO-WATCH AND AVD FROM YOUTUBE STUDIO.',
      secondary: [],
    };
  }

  const ratio = entry.stayedPct / base;
  const secondary = [];

  /* RECOVERY 3.4 — the AVD reading: stayed up + AVD down = the door improved
     and the WORDS are now on trial. That is progress, not failure. */
  if (typeof entry.avdSec === 'number' && ratio >= RATIO_PARTIAL && entry.avdSec < 13) {
    secondary.push('STAYED ROSE, AVD FELL — THE DOOR IMPROVED; THE WORDS ARE NOW GENUINELY ON TRIAL.');
  }

  /* swipe-away tripwires (optional third number, read when available) */
  if (typeof entry.swipe3sPct === 'number' && isFinite(entry.swipe3sPct)) {
    if (entry.swipe3sPct < SWIPE_HEALTHY_PCT) {
      secondary.push(`SWIPE-AWAY ${entry.swipe3sPct}% < ${SWIPE_HEALTHY_PCT}% — HEALTHY. FREEZE THIS OPENING AS THE CHANNEL TEMPLATE.`);
    } else if (entry.swipe3sPct < SWIPE_FAIL_PCT) {
      secondary.push(`SWIPE-AWAY ${entry.swipe3sPct}% < ${SWIPE_FAIL_PCT}% — PAST THE PRACTITIONER FAILURE LINE. ITERATE FROM STRENGTH.`);
    }
  }

  if (ratio >= RATIO_CONFIRMED) {
    return {
      state: 'confirmed', ratio, baseline: base, baselineN: n, baselineFallback: fallback,
      action: 'DOOR CONFIRMED — RE-DOOR THE NEXT 4 SIGNALS (NIGHT SKY, WOW, SPACE SMELL, BULLET SPEED). RESUME 48H CADENCE.',
      secondary,
    };
  }
  if (ratio >= RATIO_PARTIAL) {
    return {
      state: 'partial', ratio, baseline: base, baselineN: n, baselineFallback: fallback,
      action: 'PARTIAL — ITERATE FRAME ZERO ONLY. NOTHING ELSE CHANGES. SECOND RE-TEST.',
      secondary,
    };
  }
  return {
    state: 'failed', ratio, baseline: base, baselineN: n, baselineFallback: fallback,
    action: 'BELOW 1.3x — THE CHARACTER EXITS THE COLD OPEN CHANNEL-WIDE. ANOMALY-FIRST FORMAT (PURE ANOMALY FOOTAGE + VOICE) BEFORE TOUCHING SCRIPTS OR LANGUAGE.',
    secondary,
  };
}

/* ------------------------------------------------------------------ */
/* 30-day geography tripwires — RECOVERY 4, bottom rows. Read manually from
   YouTube Studio geography once, 30 days post-relaunch. */

export function geoVerdict({ indiaPct, usUkEuPct, weakRpm }) {
  if (typeof indiaPct === 'number' && indiaPct > 70 && weakRpm) {
    return 'ADD HINDI AUDIO TRACK (DUB, NOT REWRITE). ENGLISH STAYS MASTER.';
  }
  if (typeof usUkEuPct === 'number' && usUkEuPct > 60) {
    return 'ENGLISH-WORLD CONFIRMED PERMANENTLY.';
  }
  return 'NO GEO TRIPWIRE FIRED — KEEP SHIPPING, RE-READ AT THE NEXT 30-DAY MARK.';
}

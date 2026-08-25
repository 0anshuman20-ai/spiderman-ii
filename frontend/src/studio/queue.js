/* THE PRODUCTION QUEUE — the shooting order, not the numbering order.

   SIGNALS is a numbered library. This file is the ORDER YOU SHOOT IT IN, so the
   only decision left at the desk is "press record", never "which one next".

   The order is derived from the doctrine, not from the signal numbers:
     · pillar cadence — 3 transmission / 2 mystery / 1-2 answers per week
     · one LORE DROP every 8-10 signals (the arc has to breathe)
     · one FORMAT-BREAKER every 10-12 signals (pattern interrupt)
     · never the same world back to back — two uploads in a row on the same
       set read as one video, and the second one gets swiped
     · 43 is a HARD GATE: it reframes everything before it, so all four lore
       drops (29, 30, 31, 32) must be live before it ships

   CALENDAR_SIGNALS are NOT in this queue. They are date-triggered — drop them
   the moment their window opens, then resume the queue where you left off. */

const Q = (step, number, kind = 'standard', note = null) => ({ step, number, kind, note });

export const QUEUE_KINDS = {
  standard: { label: 'QUEUE', color: 'var(--cw-muted)' },
  lore: { label: 'LORE DROP', color: 'var(--cw-amber)' },
  breaker: { label: 'FORMAT BREAK', color: 'var(--cw-amber)' },
  reveal: { label: 'THE REVEAL', color: 'var(--cw-red)' },
};

/* Signals 1-5 (launch block), 8 and 14 are already shot — the queue starts after them.
   Mark anything else as shot in the Studio and it drops out of NEXT UP automatically. */
export const PRODUCTION_QUEUE = [
  Q(1, 6),
  Q(2, 17),
  Q(3, 7),
  Q(4, 22),
  Q(5, 12),
  Q(6, 24),
  Q(7, 9),
  Q(8, 21),
  Q(9, 29, 'lore', 'first lore drop — the arc starts here, do not skip it'),
  Q(10, 10),
  Q(11, 18),
  Q(12, 25),
  Q(13, 11),
  Q(14, 19),
  Q(15, 15),
  Q(16, 40, 'breaker', 'pattern interrupt — breaks the format on purpose'),
  Q(17, 13),
  Q(18, 16),
  Q(19, 26),
  Q(20, 20),
  Q(21, 33),
  Q(22, 30, 'lore', 'lore drop 2 — pays off the red threads planted in 29'),
  Q(23, 28),
  Q(24, 36),
  Q(25, 41, 'breaker', 'pattern interrupt — the rewatch engine'),
  Q(26, 34),
  Q(27, 31, 'lore', 'lore drop 3 — names the thing that follows him'),
  Q(28, 27),
  Q(29, 35),
  Q(30, 23),
  Q(31, 32, 'lore', 'lore drop 4 — the last plant before the reveal'),
  Q(32, 42, 'breaker', 'pattern interrupt — rewards the viewer who stayed'),
  Q(33, 43, 'reveal', 'HARD GATE: 29, 30, 31 and 32 must all be shot first'),
  Q(34, 44, 'breaker', 'the post-reveal breaker — only lands after 43'),
];

/* the five date-triggered signals — they jump the queue when their window opens */
export const CALENDAR_SIGNALS = [
  { number: 37, trigger: 'Rakesh Sharma anniversary (3 April)', window: 'publish on the day' },
  { number: 38, trigger: 'Gaganyaan G1 launch', window: 'VAULT — publish within 2 HOURS, not 24' },
  { number: 39, trigger: '25 June', window: 'annual, publish on the day' },
  { number: 45, trigger: 'June monsoon blackout', window: 'annual, any June night' },
  { number: 46, trigger: 'Diwali / Holi', window: 'annual, festival night' },
];

const CALENDAR_NUMBERS = new Set(CALENDAR_SIGNALS.map((c) => c.number));
const STEP_BY_NUMBER = PRODUCTION_QUEUE.reduce((m, q) => { m[q.number] = q; return m; }, {});

/** the queue entry for a signal number, or null if it is calendar-driven / already shipped */
export const queueEntry = (number) => STEP_BY_NUMBER[number] || null;
export const isCalendarSignal = (number) => CALENDAR_NUMBERS.has(number);

/** 43's gate: the reveal cannot ship until every lore drop before it is on tape */
export const REVEAL_PREREQS = [29, 30, 31, 32];
export function revealBlocked(progress = {}) {
  return REVEAL_PREREQS.filter((n) => !progress[n]);
}

/**
 * The next thing to shoot. Walks the queue in order, skips anything already on
 * tape, and refuses to hand you 43 while its lore prerequisites are missing.
 * Returns { entry, blockedBy } — blockedBy is non-empty only for the reveal.
 */
export function nextInQueue(progress = {}) {
  const remaining = PRODUCTION_QUEUE.filter((q) => !progress[q.number]);
  for (const entry of remaining) {
    if (entry.kind === 'reveal') {
      const blockedBy = revealBlocked(progress);
      if (blockedBy.length) continue;         // hold the reveal, shoot the rest first
    }
    return { entry, blockedBy: [] };
  }
  /* everything shootable is done — surface the reveal with its gate, if that is what is left */
  const reveal = remaining.find((q) => q.kind === 'reveal');
  if (reveal) return { entry: reveal, blockedBy: revealBlocked(progress) };
  return { entry: null, blockedBy: [] };
}

/** how far through the queue you are */
export function queueProgress(progress = {}) {
  const done = PRODUCTION_QUEUE.reduce((n, q) => n + (progress[q.number] ? 1 : 0), 0);
  return { done, total: PRODUCTION_QUEUE.length, pct: Math.round((done / PRODUCTION_QUEUE.length) * 100) };
}

/**
 * Order a signal list by the production queue. Queued signals come first in
 * shooting order, then calendar signals, then anything already shipped.
 */
export function sortByQueue(signals) {
  const rank = (s) => {
    const q = STEP_BY_NUMBER[s.number];
    if (q) return q.step;
    if (CALENDAR_NUMBERS.has(s.number)) return 1000 + s.number;
    return 2000 + s.number;                   // already shot (launch block, 8, 14)
  };
  return [...signals].sort((a, b) => rank(a) - rank(b));
}

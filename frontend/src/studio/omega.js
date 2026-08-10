/* THE OMEGA CONDUCTOR — Ω.0

   The missing noun between "a shot" and "a file": the RENDER QUEUE.

   An episode render is a queue of independent shots — the ideal thermal
   workload. The conductor plans it (per-shot cost from duration, physics,
   cinema strength and source), runs it as ONE continuous recording across
   every shot boundary, and interleaves BREATHERS after expensive shots:
   the recorder pauses, the machine cools, the file never notices.

   Honest resumability: a single continuous MediaRecorder file cannot survive
   a page reload, so the conductor never pretends it can. Instead it keeps a
   render ledger (localStorage — it is a few bytes of JSON, not media): every
   render writes its progress shot by shot, a completed render clears it, and
   an interrupted one leaves a truthful record the room can surface on boot —
   which episode, how many shots landed, when. Re-render is always from the
   top, deterministic by design: same episode + same vault = same frames. */
import { stageShot, episodeDuration } from './shotlist';

const LEDGER_KEY = 'veyl-omega-render';

/* ------------------------------------------------------------------ */
/* THE COST MODEL — what a shot demands of the machine, in weighted seconds */

export function estimateShotCost(shot) {
  let perSec = 1;                        // baseline: actor + world + composite
  if (shot.stunt) perSec += 0.6;         // fixed-step physics inside the window
  if (shot.still) perSec -= 0.25;        // the depth-mesh dolly is the cheapest pass
  perSec += (shot.cinema || 0) * 0.8;    // filmic finish scales with strength
  return shot.duration * Math.max(0.4, perSec);
}

/** plan the queue: per-shot cost + a breather after every shot that runs hot */
export function planEpisode(episode) {
  const shots = episode.shots.map((shot, i) => ({
    index: i, id: shot.id, cost: estimateShotCost(shot), breatherMs: 0,
  }));
  const total = shots.reduce((s, x) => s + x.cost, 0);
  const mean = total / Math.max(1, shots.length);
  shots.forEach((s, i) => {
    // a breather follows a hot shot — but never after the last one
    if (i < shots.length - 1 && s.cost > mean * 1.25) s.breatherMs = 900;
  });
  return { shots, totalCost: total, duration: episodeDuration(episode.shots) };
}

/* ------------------------------------------------------------------ */
/* THE RENDER LEDGER — a truthful record of the last render, nothing more */

export function readRenderLedger() {
  try { return JSON.parse(localStorage.getItem(LEDGER_KEY)) || null; } catch (_) { return null; }
}

function writeLedger(ledger) {
  try {
    if (ledger) localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
    else localStorage.removeItem(LEDGER_KEY);
  } catch (_) { /* storage unavailable — the render itself is unaffected */ }
}

export function clearRenderLedger() { writeLedger(null); }

/* ------------------------------------------------------------------ */
/* THE CONDUCTOR — one continuous take across every shot and every source */

/**
 * Render an entire episode through the Omega Stage as one continuous file.
 * The recorder keeps rolling across shot boundaries and PAUSES through the
 * planned breathers, so the export is the episode end to end with no dead air.
 *
 * Returns a handle with `stop()` (silent — no onEnd, the ledger records the
 * interruption) and the computed `plan`.
 */
export function conductEpisode(stage, recorder, episode, perfById, { onShot, onTick, onPhase, onEnd } = {}) {
  const plan = planEpisode(episode);
  let idx = -1;
  let elapsed = 0;
  let stopped = false;

  const ledger = {
    episodeId: episode.id, name: episode.name,
    shots: episode.shots.length, done: 0,
    state: 'rendering', startedAt: new Date().toISOString(),
  };
  writeLedger(ledger);
  recorder.start(stage, null);

  const finishComplete = async () => {
    const take = await recorder.stop();
    writeLedger(null);                       // a finished render leaves no debt
    if (onEnd) onEnd(take);
  };

  const next = () => {
    if (stopped) return;
    idx += 1;
    if (idx >= episode.shots.length) { finishComplete(); return; }
    const shot = episode.shots[idx];
    ledger.done = idx;
    writeLedger(ledger);
    stage.load(stageShot(shot, shot.perfId ? perfById[shot.perfId] : null));
    if (onShot) onShot(idx, shot);
    if (onPhase) onPhase('shot');
    stage.play({
      onTick: (t) => { if (onTick) onTick(elapsed + t, idx); },
      onEnd: () => {
        if (stopped) return;
        elapsed += shot.duration;
        const br = plan.shots[idx].breatherMs;
        if (br > 0 && recorder.pause()) {
          if (onPhase) onPhase('breather');
          setTimeout(() => {
            if (stopped) return;
            recorder.resume();
            next();
          }, br);
        } else {
          next();
        }
      },
    });
  };
  next();

  return {
    plan,
    stop() {
      if (stopped) return;
      stopped = true;
      stage.pause();
      ledger.state = 'interrupted';
      ledger.done = Math.max(0, idx);
      writeLedger(ledger);
      recorder.stop();                       // discard-safe: caller gets nothing
    },
  };
}

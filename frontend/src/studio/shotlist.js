/* THE EPISODE — Ω.5

   The deliverable stops being a take.

   A `.veylep` is an ordered list of SHOTS, each referencing a source — a performed
   `.veyl` span, a synthetic-actor shot, a Motion Bank assembly, a stunt window —
   plus one continuity ledger. It is small (it stores references, not frames),
   versioned, diffable, and re-renderable end to end: same episode + same vault
   = same frames, forever.

   Continuity is ENFORCED, not hoped for. The ledger below is a set of
   deterministic editorial rules — world continuity, jump cuts, crossing the line,
   stunt coverage — that run on every edit and flag a broken cut BEFORE export.

   Honest labeling is structural: a shot's source badge is derived from its data
   and burned into every rendered frame. The studio never lies to you about which
   frames a camera saw. */
import { createStunt, STUNT_PRESETS } from './stunt';
import { RIG_BY_KEY } from './omegaStage';

const STUNT_BY_KEY = STUNT_PRESETS.reduce((m, s) => { m[s.key] = s; return m; }, {});

/* ------------------------------------------------------------------ */
/* the container                                                        */

export function makeEpisode({ name = 'episode-01' } = {}) {
  return {
    magic: 'VEYLEP', v: 2,
    id: `e${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    name,
    createdAt: new Date().toISOString(),
    shots: [],
  };
}

/** derive the honest source badge for a shot from its data — never from a claim */
export function shotSource(shot, perf) {
  if (shot.stunt) return 'stunt';
  if (!perf) return 'synthetic';
  if (perf.source === 'performed') return 'performed';
  if (perf.source === 'bank') return 'bank';
  return 'synthetic';
}

/** freeze the Omega Room's current state into a shot reference */
export function makeShot({ perf, rig = 'medium', world = 'nebula-drift', stuntKey = null, stuntStart = 0, stuntLen = 0 }) {
  const duration = perf ? perf.duration : 3;
  const stunt = stuntKey && STUNT_BY_KEY[stuntKey]
    ? { key: stuntKey, t0: Math.max(0, Math.min(duration - 1.2, stuntStart)), len: stuntLen }
    : null;
  const shot = {
    id: `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    perfId: perf ? perf.id : null,
    perfName: perf ? perf.name : 'procedural idle',
    rig, world, duration, stunt,
  };
  shot.source = shotSource(shot, perf);
  return shot;
}

export const episodeDuration = (shots) => shots.reduce((s, x) => s + x.duration, 0);

/* ------------------------------------------------------------------ */
/* THE CONTINUITY LEDGER — deterministic editorial rules, run on every edit */

export function checkContinuity(shots) {
  const ledger = [];
  const flag = (shot, level, rule, msg) => ledger.push({ shotId: shot.id, level, rule, msg });

  shots.forEach((shot, i) => {
    const prev = i > 0 ? shots[i - 1] : null;

    // 1 · world continuity: a cut that changes worlds breaks the scene's geography
    if (prev && prev.world !== shot.world) {
      flag(shot, 'warn', 'WORLD JUMP', `cut changes world from ${prev.world} to ${shot.world}`);
    }
    // 2 · jump cut: same camera on the same take, back to back
    if (prev && prev.rig === shot.rig && prev.perfId === shot.perfId && prev.perfId) {
      flag(shot, 'warn', 'JUMP CUT', 'same rig on the same take — change the angle or the source');
    }
    // 3 · crossing the line: a reverse needs established geography before it
    const badge = (RIG_BY_KEY[shot.rig] || RIG_BY_KEY.medium).badge;
    if (badge === 'reverse' && i === 0) {
      flag(shot, 'info', 'REVERSE FIRST', 'reverse angle opens the cut — establish geography first');
    }
    // 4 · stunt coverage: a stunt framed like a talking head wastes the arc
    if (shot.stunt && badge === 'intercut') {
      flag(shot, 'info', 'STUNT IN A MEDIUM', 'stunt inside the intercut frame — SWING CHASE or a wide reads better');
    }
    // 5 · stunt window must fit inside its shot
    if (shot.stunt && shot.stunt.t0 + shot.stunt.len > shot.duration + 0.05) {
      flag(shot, 'warn', 'WINDOW OVERRUN', 'stunt window extends past the end of the shot');
    }
  });

  // 6 · the close-out: the truth lives in performed frames
  const last = shots[shots.length - 1];
  if (last && last.source !== 'performed' && shots.length > 1) {
    flag(last, 'info', 'SYNTHETIC CLOSE', 'episode ends on a synthetic source — a performed close-out reads truer');
  }
  return ledger;
}

/* ------------------------------------------------------------------ */
/* THE RENDER QUEUE — one continuous pass over every shot, deterministic */

/** rebuild a stage-ready shot description (incl. a freshly baked stunt) from a reference */
export function stageShot(shot, perf) {
  let solver = null;
  if (shot.stunt && STUNT_BY_KEY[shot.stunt.key]) {
    const s0 = shot.stunt.t0;
    const s1 = Math.min(shot.duration - 0.05, s0 + shot.stunt.len);
    solver = createStunt(STUNT_BY_KEY[shot.stunt.key].make(s0, s1));
  }
  const badge = shot.stunt
    ? `stunt · ${STUNT_BY_KEY[shot.stunt.key].name.toLowerCase()}`
    : shot.source;
  return {
    performance: perf || null, rig: shot.rig, world: shot.world,
    in: 0, out: shot.duration, stunt: solver,
    label: `${badge} · ${(RIG_BY_KEY[shot.rig] || RIG_BY_KEY.medium).badge}`,
  };
}

/**
 * Play an entire episode through the Omega Stage as one continuous take —
 * the recorder (if any) keeps rolling across shot boundaries, so the export
 * is the episode, end to end, in one file. Returns a handle with `stop()`.
 */
export function playEpisode(stage, episode, perfById, { onShot, onTick, onEnd } = {}) {
  let idx = -1;
  let elapsed = 0;
  let stopped = false;

  const next = () => {
    if (stopped) return;
    idx += 1;
    if (idx >= episode.shots.length) { if (onEnd) onEnd(); return; }
    const shot = episode.shots[idx];
    const perf = shot.perfId ? perfById[shot.perfId] : null;
    stage.load(stageShot(shot, perf));
    if (onShot) onShot(idx, shot);
    stage.play({
      onTick: (t) => { if (onTick) onTick(elapsed + t, idx); },
      onEnd: () => { elapsed += shot.duration; next(); },
    });
  };
  next();

  return {
    stop() { stopped = true; stage.pause(); },
  };
}

/* ------------------------------------------------------------------ */
/* `.veylep` on disk — references only, human-diffable JSON */

export function downloadEpisode(episode) {
  const blob = new Blob([JSON.stringify(episode, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${episode.name}.veylep`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

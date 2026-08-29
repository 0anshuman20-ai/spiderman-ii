/* POST-TAKE REPORT CARD — RETENTION_FIX_PLAN Phase 6 item 2/3.

   One-glance pass/fail per row, built from three telemetry surfaces the
   earlier phases installed:
     - the recorder's watchdog telemetry (effective fps, duplicated-frame
       ratio, tier/codec) — Phase 2 item 5,
     - the voice engine's post-take loudness verification (LUFS estimate +
       sample peak off the FINAL recorder feed) — Phase 4 item 6,
     - the take director's change/hook counters — Phase 5.

   The PUBLISH GUARD is the plan's exact critical set: effective fps < 24,
   loudness/peak out of spec, or the floor tier. A take failing any critical
   row is flagged (`pass: false`) — the studio then skips the silent
   auto-download and the takes rail shows the failure, but SAVE remains as
   the explicit override. Overridable, never silent. */

const TIER_RES = { high: '1080×1920', medium: '810×1440 (WC: 1080×1920)', low: '720×1280' };

/**
 * @param take     recorder take object (tier, mime, duration, effectiveFps, dupRatio…)
 * @param director director.report — { changes, hooked, hookText }
 * @param audio    voice.lastTakeAudioReport — { lufs, peakDb, ok } | null
 */
export function buildTakeReport(take, director, audio) {
  const rows = [];
  const push = (label, value, ok, critical) => rows.push({ label, value, ok, critical: !!critical });

  /* effective fps — the frames the viewer actually saw (critical: >= 24) */
  const fps = typeof take.effectiveFps === 'number' ? take.effectiveFps : null;
  push('EFFECTIVE FPS', fps == null ? '—' : `${fps}`, fps == null || fps >= 24, true);

  /* duplicated frames — >20% means the watchdog shipped a slideshow (warn) */
  const dup = typeof take.dupRatio === 'number' ? take.dupRatio : 0;
  push('DUP FRAMES', `${Math.round(dup * 100)}%`, dup <= 0.2, false);

  /* tier — the floor tier is a critical failure by plan */
  push('TIER / RES', `${(take.tier || '?').toUpperCase()} · ${TIER_RES[take.tier] || '?'}`, take.tier !== 'low', true);

  /* codec — informational */
  push('CODEC', String(take.mime || '?').split(';')[0].replace('video/', ''), true, false);

  /* loudness + true peak — Phase 4's -14 LUFS / -1.0 dBTP contract (critical) */
  if (audio) {
    push('LOUDNESS', `${audio.lufs} LUFS`, audio.lufs >= -16 && audio.lufs <= -12, true);
    push('PEAK', `${audio.peakDb} dBFS`, audio.peakDb <= -1.0, true);
  } else {
    push('LOUDNESS', '— (no meter)', true, false);
  }

  /* retention layer — entrance beat + one visible change per ~3s (warn) */
  if (director) {
    push('HOOK', director.hooked ? 'ENTRANCE BEAT ✓' : 'NONE', !!director.hooked, false);
    const need = Math.max(1, Math.floor((take.duration || 0) / 3));
    push('VISUAL CHANGES', `${director.changes} (need ~${need})`, director.changes >= need, false);
  }

  const pass = rows.every((r) => r.ok || !r.critical);
  return { rows, pass };
}

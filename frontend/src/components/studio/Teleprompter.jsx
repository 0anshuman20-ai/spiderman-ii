import { useMemo, useState } from 'react';
import { TRANSMISSIONS, PILLARS } from '../../studio/scripts';
import {
  PRODUCTION_QUEUE, CALENDAR_SIGNALS, QUEUE_KINDS,
  queueEntry, isCalendarSignal, nextInQueue, queueProgress, sortByQueue,
} from '../../studio/queue';

const BY_NUMBER = TRANSMISSIONS.reduce((m, s) => { m[s.number] = s; return m; }, {});

/* NEXT UP — the whole point: one card that tells you exactly what to shoot now,
   in doctrine order, so no signal is ever hunted for again. */
export const NextUp = ({ progress, onPick, active }) => {
  const { entry, blockedBy } = useMemo(() => nextInQueue(progress), [progress]);
  const stats = useMemo(() => queueProgress(progress), [progress]);
  const upcoming = useMemo(
    () => PRODUCTION_QUEUE.filter((q) => !progress[q.number] && (!entry || q.step > entry.step)).slice(0, 3),
    [progress, entry]
  );
  const script = entry ? BY_NUMBER[entry.number] : null;
  const kind = entry ? QUEUE_KINDS[entry.kind] : null;

  return (
    <div className="cw-panel" data-testid="next-up">
      <h2>▶ Next Up — Queue {stats.done}/{stats.total}</h2>
      <div className="cw-meter mb-2" style={{ height: 4 }}>
        <div style={{ width: `${stats.pct}%`, background: 'var(--cw-green)' }} />
      </div>

      {!script ? (
        <p className="mono text-[10px] m-0" style={{ color: 'var(--cw-green)' }}>
          QUEUE CLEAR — every non-calendar signal is on tape.
        </p>
      ) : (
        <>
          <div
            className={`cw-chip ${active && active.number === script.number ? 'on' : ''}`}
            style={{ justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap', padding: '9px 10px' }}
            data-testid={`next-up-pick-${script.number}`}
            onClick={() => onPick(script)}>
            <span className="mono text-[9px]" style={{ color: 'var(--cw-red)', letterSpacing: '0.15em' }}>
              STEP {String(entry.step).padStart(2, '0')}
            </span>
            <span className="flex-1 truncate" style={{ fontSize: 11 }}>{script.title}</span>
            <small className="mono" style={{ color: 'var(--cw-muted)' }}>{script.world} · {script.durationSec}s</small>
            {entry.kind !== 'standard' && (
              <small className="mono text-[9px]" style={{ color: kind.color, letterSpacing: '0.12em' }}>{kind.label}</small>
            )}
          </div>
          {entry.note && (
            <p className="mono text-[9px] mt-1 mb-0" style={{ color: 'var(--cw-muted)' }}>◮ {entry.note.toUpperCase()}</p>
          )}
          {blockedBy.length > 0 && (
            <p className="mono text-[9px] mt-1 mb-0" style={{ color: 'var(--cw-red)' }} data-testid="next-up-blocked">
              ⨂ GATED — SHOOT {blockedBy.map((n) => `#${String(n).padStart(2, '0')}`).join(', ')} FIRST
            </p>
          )}
        </>
      )}

      {upcoming.length > 0 && (
        <div className="mt-2">
          <span className="mono text-[9px]" style={{ color: 'var(--cw-muted)', letterSpacing: '0.15em' }}>THEN</span>
          <div className="space-y-0.5 mt-0.5">
            {upcoming.map((q) => {
              const s = BY_NUMBER[q.number];
              if (!s) return null;
              return (
                <div key={q.step} className="flex items-center gap-2 mono text-[9px]" style={{ color: 'var(--cw-text-2)' }}>
                  <span style={{ color: 'var(--cw-muted)', minWidth: 42 }}>STEP {String(q.step).padStart(2, '0')}</span>
                  <span className="flex-1 truncate">{s.title}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--cw-border)' }}>
        <span className="mono text-[9px]" style={{ color: 'var(--cw-muted)', letterSpacing: '0.15em' }}>
          OFF-QUEUE · DATE TRIGGERED
        </span>
        <div className="space-y-0.5 mt-0.5" data-testid="calendar-signals">
          {CALENDAR_SIGNALS.map((c) => {
            const s = BY_NUMBER[c.number];
            if (!s) return null;
            return (
              <div key={c.number} className="flex items-center gap-2 mono text-[9px]"
                style={{ color: progress[c.number] ? 'var(--cw-green)' : 'var(--cw-text-2)', cursor: 'pointer' }}
                onClick={() => onPick(s)}>
                <span style={{ color: 'var(--cw-muted)', minWidth: 26 }}>
                  {progress[c.number] ? '✓' : '#'}{String(c.number).padStart(2, '0')}
                </span>
                <span className="flex-1 truncate">{c.trigger}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const ScriptLog = ({ active, onPick, progress, recording = false, beatIdx = 0 }) => {
  const [filter, setFilter] = useState('queue');
  const list = useMemo(() => {
    if (filter === 'queue') return sortByQueue(TRANSMISSIONS);
    if (filter === 'all') return TRANSMISSIONS;
    return TRANSMISSIONS.filter((s) => s.pillar === filter);
  }, [filter]);
  /* coverage: how much of the whole transmission slate is on tape */
  const recorded = useMemo(
    () => TRANSMISSIONS.reduce((n, s) => n + (progress[s.number] ? 1 : 0), 0),
    [progress]
  );
  const pct = Math.round((recorded / TRANSMISSIONS.length) * 100);
  return (
    <div className="cw-panel flex flex-col min-h-0" data-testid="script-log" style={{ flex: 1 }}>
      <h2>▤ Transmission Log — {TRANSMISSIONS.length} Scripts</h2>
      <div className="flex items-center gap-2 mb-2" data-testid="coverage-meter">
        <div className="cw-meter flex-1" style={{ height: 4 }}>
          <div style={{ width: `${pct}%`, background: 'var(--cw-green)' }} />
        </div>
        <span className="mono text-[9px]" style={{ color: pct === 100 ? 'var(--cw-green)' : 'var(--cw-muted)', whiteSpace: 'nowrap' }}>
          {recorded}/{TRANSMISSIONS.length} · {pct}%
        </span>
      </div>
      <div className="flex flex-wrap gap-1 mb-2">
        <div className={`cw-chip ${filter === 'queue' ? 'on' : ''}`} style={{ padding: '4px 7px', fontSize: 9 }}
          data-testid="pillar-filter-queue" onClick={() => setFilter('queue')}>▶ SHOOT ORDER</div>
        <div className={`cw-chip ${filter === 'all' ? 'on' : ''}`} style={{ padding: '4px 7px', fontSize: 9 }}
          data-testid="pillar-filter-all" onClick={() => setFilter('all')}>ALL</div>
        {Object.entries(PILLARS).map(([k, p]) => (
          <div key={k} className={`cw-chip ${filter === k ? 'on' : ''}`} style={{ padding: '4px 7px', fontSize: 9 }}
            data-testid={`pillar-filter-${k}`} onClick={() => setFilter(k)}>{p.label}</div>
        ))}
      </div>
      <div className="overflow-y-auto space-y-1" style={{ maxHeight: 320 }}>
        {list.map((s) => {
          const isActive = active && active.id === s.id;
          const q = queueEntry(s.number);
          return (
            <div key={s.id}
              className={`cw-chip ${isActive ? 'on' : ''}`}
              style={{ justifyContent: 'flex-start', gap: 10, flexWrap: 'wrap' }}
              data-testid={`script-item-${s.number}`}
              onClick={() => onPick(s)}>
              <span className="mono" style={{ color: progress[s.number] ? 'var(--cw-green)' : 'var(--cw-muted)', minWidth: 26 }}>
                {progress[s.number] ? '✓' : '#'}{String(s.number).padStart(2, '0')}
              </span>
              {q ? (
                <span className="mono text-[9px]" style={{ color: 'var(--cw-red)', minWidth: 46, letterSpacing: '0.1em' }}>
                  STEP {String(q.step).padStart(2, '0')}
                </span>
              ) : (
                <span className="mono text-[9px]" style={{ color: 'var(--cw-muted)', minWidth: 46, letterSpacing: '0.1em' }}>
                  {isCalendarSignal(s.number) ? 'DATED' : 'SHOT'}
                </span>
              )}
              <span className="flex-1 truncate" style={{ fontSize: 10 }}>{s.title}</span>
              <small className="mono" style={{ color: 'var(--cw-muted)' }}>{s.beats.length}B · {s.durationSec}s</small>
              <small style={{ color: PILLARS[s.pillar].color }}>{PILLARS[s.pillar].label}</small>
              {q && q.kind !== 'standard' && (
                <small className="mono text-[9px]" style={{ color: QUEUE_KINDS[q.kind].color }}>{QUEUE_KINDS[q.kind].label}</small>
              )}
              {isActive && recording && (
                <div className="cw-meter w-full" style={{ height: 3 }} data-testid={`script-beat-progress-${s.number}`}>
                  <div style={{ width: `${Math.min(100, ((beatIdx + 1) / s.beats.length) * 100)}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* UPLOAD KIT — everything YouTube asks for at publish time, one copy button
   per field, straight from the picked script. Only renders for scripts that
   carry publish metadata (the launch sequence). */
export const UploadKit = ({ script }) => {
  const [copied, setCopied] = useState(null);
  if (!script || !script.videoTitle) return null;
  const copy = async (field, value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(field);
      setTimeout(() => setCopied(null), 1400);
    } catch (_) { /* clipboard unavailable */ }
  };
  const rows = [
    ['TITLE', script.videoTitle],
    ['DESCRIPTION', script.description],
    ['TAGS', (script.tags || []).join(', ')],
    ['PINNED COMMENT', script.pinnedComment],
  ];
  return (
    <div className="cw-panel" data-testid="upload-kit">
      <h2>
        ⬆ Upload Kit — #{String(script.number).padStart(2, '0')}
        {script.best && <span className="mono text-[9px] ml-2" style={{ color: 'var(--cw-green)' }}>★ POST THIS FIRST</span>}
        {script.publishOrder && !script.best && <span className="mono text-[9px] ml-2" style={{ color: 'var(--cw-muted)' }}>UPLOAD #{script.publishOrder}</span>}
      </h2>
      <div className="space-y-2">
        {rows.map(([label, value]) => value ? (
          <div key={label}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="mono text-[9px]" style={{ color: 'var(--cw-muted)', letterSpacing: '0.15em' }}>{label}</span>
              <button className="mono text-[9px] cursor-pointer bg-transparent border-0"
                style={{ color: copied === label ? 'var(--cw-green)' : 'var(--cw-amber)' }}
                data-testid={`upload-kit-copy-${label.toLowerCase().replace(/\s+/g, '-')}`}
                onClick={() => copy(label, value)}>
                {copied === label ? '✓ COPIED' : 'COPY'}
              </button>
            </div>
            <p className="mono text-[10px] whitespace-pre-wrap" style={{ color: 'var(--cw-text-2)', maxHeight: 72, overflowY: 'auto' }}>{value}</p>
          </div>
        ) : null)}
        {script.whyItWorks && (
          <div>
            <span className="mono text-[9px]" style={{ color: 'var(--cw-muted)', letterSpacing: '0.15em' }}>WHY THIS WORKS</span>
            <p className="mono text-[9px] mt-0.5" style={{ color: 'var(--cw-muted)' }}>{script.whyItWorks}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export const Prompter = ({ script, beatIdx, recording, elapsed, onClose }) => {
  if (!script) return null;
  const beats = script.beats;
  const idx = Math.min(beatIdx, beats.length - 1);
  const beat = beats[idx];
  const next = idx + 1 < beats.length ? beats[idx + 1] : null;
  const done = recording && elapsed > script.durationSec - 3;
  return (
    <div className="cw-prompter" data-testid="teleprompter">
      <div className="flex items-center justify-between mb-2">
        <span className="mono text-[9px]" style={{ color: 'var(--cw-red)', letterSpacing: '0.2em' }}>
          TRANSMISSION #{String(script.number).padStart(2, '0')} · BEAT {idx + 1}/{beats.length} · {script.durationSec}s
        </span>
        <button className="mono text-[9px] cursor-pointer bg-transparent border-0" style={{ color: 'var(--cw-muted)' }}
          data-testid="prompter-close" onClick={onClose}>✕ CLOSE</button>
      </div>
      <div className="beat-now" data-testid="prompter-current-line">
        {done ? script.loopLine : beat.text}
      </div>
      {beat.note && !done && <div className="note">◮ {beat.note.toUpperCase()}</div>}
      {next && !done && <div className="beat-next">NEXT → {next.text}</div>}
      {done && <div className="note">◮ LOOP LINE — HOLD, THEN CUT</div>}
      <div className="cw-meter mt-2" style={{ height: 3 }}>
        <div style={{ width: recording ? `${Math.min(100, (elapsed / script.durationSec) * 100)}%` : '0%' }} />
      </div>
    </div>
  );
};

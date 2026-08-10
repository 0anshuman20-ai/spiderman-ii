import { useMemo, useState } from 'react';
import { TRANSMISSIONS, PILLARS } from '../../studio/scripts';

export const ScriptLog = ({ active, onPick, progress }) => {
  const [filter, setFilter] = useState('all');
  const list = useMemo(
    () => (filter === 'all' ? TRANSMISSIONS : TRANSMISSIONS.filter((s) => s.pillar === filter)),
    [filter]
  );
  return (
    <div className="cw-panel flex flex-col min-h-0" data-testid="script-log" style={{ flex: 1 }}>
      <h2>▤ Transmission Log — {TRANSMISSIONS.length} Scripts</h2>
      <div className="flex flex-wrap gap-1 mb-2">
        <div className={`cw-chip ${filter === 'all' ? 'on' : ''}`} style={{ padding: '4px 7px', fontSize: 9 }}
          data-testid="pillar-filter-all" onClick={() => setFilter('all')}>ALL</div>
        {Object.entries(PILLARS).map(([k, p]) => (
          <div key={k} className={`cw-chip ${filter === k ? 'on' : ''}`} style={{ padding: '4px 7px', fontSize: 9 }}
            data-testid={`pillar-filter-${k}`} onClick={() => setFilter(k)}>{p.label}</div>
        ))}
      </div>
      <div className="overflow-y-auto space-y-1" style={{ maxHeight: 320 }}>
        {list.map((s) => (
          <div key={s.id}
            className={`cw-chip ${active && active.id === s.id ? 'on' : ''}`}
            style={{ justifyContent: 'flex-start', gap: 10 }}
            data-testid={`script-item-${s.number}`}
            onClick={() => onPick(s)}>
            <span className="mono" style={{ color: progress[s.number] ? 'var(--cw-green)' : 'var(--cw-muted)', minWidth: 26 }}>
              {progress[s.number] ? '✓' : '#'}{String(s.number).padStart(2, '0')}
            </span>
            <span className="flex-1 truncate" style={{ fontSize: 10 }}>{s.title}</span>
            <small style={{ color: PILLARS[s.pillar].color }}>{PILLARS[s.pillar].label}</small>
          </div>
        ))}
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

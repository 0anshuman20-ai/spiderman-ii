import { WORLDS } from '../../studio/worlds';
import { CAMERA_RIGS } from '../../studio/omegaStage';
import { STUNT_PRESETS } from '../../studio/stunt';

const fmtDur = (s) => `${s.toFixed(1)}s`;

/* which take drives the body — every entry is honest about its source */
export const SourcePanel = ({ perfs, activeId, onPick, onForge, memoryOnly }) => (
  <div className="cw-panel" data-testid="omega-source-panel">
    <h2>◈ Performance Source</h2>
    <div className="grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto pr-1">
      {perfs.map((p) => (
        <div key={p.id} className={`cw-chip ${activeId === p.id ? 'on' : ''}`}
          data-testid={`omega-perf-${p.id}`} onClick={() => onPick(p.id)}>
          <span className="truncate">{p.name}</span>
          <small style={{ color: p.source === 'performed' ? 'var(--cw-red)' : 'var(--cw-amber)' }}>
            {p.source === 'performed' ? 'PERFORMED' : 'SYNTHETIC'} · {fmtDur(p.duration)}
          </small>
        </div>
      ))}
      {perfs.length === 0 && (
        <p className="mono text-[9px]" style={{ color: 'var(--cw-muted)' }}>
          VAULT EMPTY — record a take in the studio, or forge one below
        </p>
      )}
    </div>
    <button className="cw-chip w-full mt-2" style={{ color: 'var(--cw-amber)' }}
      data-testid="omega-forge-btn" onClick={onForge}>
      <span>⚗ FORGE SYNTHETIC TAKE</span><small>FK</small>
    </button>
    {memoryOnly && (
      <p className="mono text-[9px] mt-2" style={{ color: 'var(--cw-amber)' }}>
        VAULT: MEMORY ONLY — takes will not survive reload
      </p>
    )}
  </div>
);

export const RigPanel = ({ rig, onRig }) => (
  <div className="cw-panel" data-testid="omega-rig-panel">
    <h2>◉ Camera Rig</h2>
    <div className="grid grid-cols-1 gap-1.5">
      {CAMERA_RIGS.map((r) => (
        <div key={r.key} className={`cw-chip ${rig === r.key ? 'on' : ''}`}
          data-testid={`omega-rig-${r.key}`} onClick={() => onRig(r.key)}>
          <span>{r.name}</span><small>{r.badge.toUpperCase()}</small>
        </div>
      ))}
    </div>
  </div>
);

export const OmegaWorldPanel = ({ world, onWorld }) => (
  <div className="cw-panel" data-testid="omega-world-panel">
    <h2>◈ World</h2>
    <div className="grid grid-cols-1 gap-1.5">
      {WORLDS.map((w) => (
        <div key={w.key} className={`cw-chip ${world === w.key ? 'on' : ''}`}
          data-testid={`omega-world-${w.key}`} onClick={() => onWorld(w.key)}>
          <span>{w.name}</span>
        </div>
      ))}
    </div>
  </div>
);

/* Ω.4 — the takeover window. Physics owns the body inside it; the performance
   owns everything outside it. Start/length place the window inside the shot. */
export const StuntPanel = ({ stunt, onStunt, start, len, dur, onStart, onLen }) => {
  const maxStart = Math.max(0.2, dur - 1.2);
  const maxLen = Math.max(1.2, Math.min(5, dur - start - 0.1));
  return (
    <div className="cw-panel" data-testid="omega-stunt-panel">
      <h2>⌁ Stunt Engine</h2>
      <div className="grid grid-cols-1 gap-1.5 mb-3">
        <div className={`cw-chip ${!stunt ? 'on' : ''}`} data-testid="omega-stunt-none"
          onClick={() => onStunt(null)}>
          <span>NO TAKEOVER</span><small>PERFORMED</small>
        </div>
        {STUNT_PRESETS.map((s) => (
          <div key={s.key} className={`cw-chip ${stunt === s.key ? 'on' : ''}`}
            data-testid={`omega-stunt-${s.key}`} onClick={() => onStunt(s.key)}>
            <span>{s.name}</span><small style={{ color: 'var(--cw-red)' }}>PHYSICS</small>
          </div>
        ))}
      </div>
      {stunt && (
        <>
          <div className="cw-slider">
            <div className="lab"><span>Window Start</span><b>{start.toFixed(1)}s</b></div>
            <input type="range" min={0} max={maxStart} step={0.1} value={Math.min(start, maxStart)}
              data-testid="omega-stunt-start" onChange={(e) => onStart(parseFloat(e.target.value))} />
          </div>
          <div className="cw-slider">
            <div className="lab"><span>Window Length</span><b>{len.toFixed(1)}s</b></div>
            <input type="range" min={1.2} max={maxLen} step={0.1} value={Math.min(len, maxLen)}
              data-testid="omega-stunt-len" onChange={(e) => onLen(parseFloat(e.target.value))} />
          </div>
          <p className="mono text-[9px] mt-1" style={{ color: 'var(--cw-muted)' }}>
            VERLET · 1/240s FIXED STEP · BAKED — SAME ARC ON EVERY RE-RENDER
          </p>
        </>
      )}
      {STUNT_PRESETS.map((s) => (stunt === s.key ? (
        <p key={s.key} className="mono text-[9px] mt-2" style={{ color: 'var(--cw-text-2)' }}>{s.detail.toUpperCase()}</p>
      ) : null))}
    </div>
  );
};


import { WORLDS } from '../../studio/worlds';
import { CAMERA_RIGS } from '../../studio/omegaStage';
import { STUNT_PRESETS } from '../../studio/stunt';
import { GESTURES } from '../../studio/perf';

const fmtDur = (s) => `${s.toFixed(1)}s`;

const fmtBytes = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

/* which take drives the body — every entry is honest about its source.
   Each performance exports to disk as a `.veyl` file; the IMPORT input
   parses one back into the Vault under a fresh id. */
export const SourcePanel = ({ perfs, activeId, onPick, onForge, memoryOnly, onExport, onImport, importError, usage, persisted }) => (
  <div className="cw-panel" data-testid="omega-source-panel">
    <h2>◈ Performance Source</h2>
    <div className="grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto pr-1">
      {perfs.map((p) => (
        <div key={p.id} className={`cw-chip ${activeId === p.id ? 'on' : ''}`}
          data-testid={`omega-perf-${p.id}`} onClick={() => onPick(p.id)}>
          <span className="truncate">{p.name}</span>
          <small style={{ color: p.source === 'performed' ? 'var(--cw-red)' : p.source === 'bank' ? 'var(--cw-amber)' : 'var(--cw-amber)' }}>
            {(p.source || 'synthetic').toUpperCase()} · {fmtDur(p.duration)}
          </small>
          <button className="bg-transparent border-0 cursor-pointer mono"
            style={{ color: 'var(--cw-green)', fontSize: 9 }}
            aria-label={`Export ${p.name} as .veyl`}
            data-testid={`omega-perf-export-${p.id}`}
            onClick={(e) => { e.stopPropagation(); onExport(p); }}>▼ .VEYL</button>
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
    <label className="cw-chip w-full mt-1.5 cursor-pointer" style={{ color: 'var(--cw-cyan)' }}
      data-testid="omega-import-label">
      <span>⇪ IMPORT .VEYL FILE</span><small>VAULT</small>
      <input type="file" accept=".veyl,application/octet-stream" className="sr-only"
        data-testid="omega-import-input"
        onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) onImport(f); e.target.value = ''; }} />
    </label>
    {importError && (
      <p className="mono text-[9px] mt-1" style={{ color: 'var(--cw-red)' }} data-testid="omega-import-error">
        ⚠ {String(importError).toUpperCase()}
      </p>
    )}
    <p className="mono text-[9px] mt-2" style={{ color: 'var(--cw-muted)' }} data-testid="omega-vault-usage">
      VAULT: {usage && usage.quota ? `${fmtBytes(usage.usage)} OF ${fmtBytes(usage.quota)}` : 'USAGE UNKNOWN'}
      {' · '}{persisted ? 'PERSISTENT — SURVIVES EVICTION' : 'BEST-EFFORT STORAGE'}
    </p>
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

/* Ω.2 — THE MOTION BANK. Performance without performing: beats in, a take made of
   your own recorded frames out. Honest by design — the coverage meter states
   exactly which vocabulary the Vault can speak, and how many real seconds back it. */
export const MotionBankPanel = ({ bank, beats, onBeats, onAssemble, busy, continuation }) => {
  const coverage = bank ? bank.coverage() : {};
  const maxCov = Math.max(0.001, ...Object.values(coverage));
  return (
    <div className="cw-panel" data-testid="omega-bank-panel">
      <h2>▤ Motion Bank</h2>
      {bank && bank.count > 0 ? (
        <p className="mono text-[9px] mb-2" style={{ color: 'var(--cw-text-2)' }} data-testid="omega-bank-stats">
          {bank.performances.length} TAKES · {bank.seconds.toFixed(1)}s INDEXED · {bank.count} POSES
        </p>
      ) : (
        <p className="mono text-[9px] mb-2" style={{ color: 'var(--cw-muted)' }} data-testid="omega-bank-stats">
          BANK EMPTY — EVERY TAKE IN THE VAULT FEEDS IT
        </p>
      )}

      {/* coverage meter: the bank is a library, not a dream */}
      <div className="space-y-1 mb-3" data-testid="omega-bank-coverage">
        {GESTURES.map((g) => {
          const sec = coverage[g] || 0;
          return (
            <div key={g} className="flex items-center gap-2">
              <span className="mono text-[9px] w-14 uppercase" style={{ color: sec > 0 ? 'var(--cw-text-2)' : 'var(--cw-muted)' }}>{g}</span>
              <div className="flex-1 h-1 rounded-sm" style={{ background: 'var(--cw-border)' }}>
                <div className="h-full rounded-sm" style={{ width: `${Math.min(100, (sec / maxCov) * 100)}%`, background: sec > 0 ? 'var(--cw-amber)' : 'transparent' }} />
              </div>
              <span className="mono text-[9px] w-9 text-right" style={{ color: 'var(--cw-muted)' }}>{sec.toFixed(1)}s</span>
            </div>
          );
        })}
      </div>

      {/* beat sequencer: tap gestures to write the blocking */}
      <div className="flex flex-wrap gap-1 mb-2" data-testid="omega-bank-gestures">
        {GESTURES.map((g) => (
          <button key={g} className="cw-chip" style={{ padding: '4px 8px' }}
            data-testid={`omega-bank-beat-${g}`} onClick={() => onBeats([...beats, g])}>
            <span className="text-[9px] uppercase">{g}</span>
          </button>
        ))}
      </div>
      <div className="mono text-[9px] mb-2 min-h-4" style={{ color: 'var(--cw-amber)' }} data-testid="omega-bank-sequence">
        {beats.length ? beats.map((b) => b.toUpperCase()).join(' → ') : 'TAP BEATS TO WRITE THE BLOCKING'}
        {beats.length > 0 && (
          <button className="ml-2 underline" style={{ color: 'var(--cw-muted)' }}
            data-testid="omega-bank-clear" onClick={() => onBeats([])}>CLEAR</button>
        )}
      </div>
      <button className="cw-chip w-full" style={{ color: 'var(--cw-amber)' }}
        disabled={busy || !bank || !bank.count || beats.length === 0}
        data-testid="omega-bank-assemble" onClick={onAssemble}>
        <span>{busy ? '▤ MATCHING…' : '▤ ASSEMBLE FROM VAULT'}</span><small>MOTION MATCH</small>
      </button>
      <p className="mono text-[9px] mt-2" style={{ color: 'var(--cw-muted)' }}>
        EVERY FRAME IT EMITS IS A FRAME YOU PERFORMED · MATCHING IS DETERMINISTIC
      </p>
      {/* Ω.2b — the gated continuation model. Honest either way: trained on your
         corpus, or gated off with the linear blend named as the fallback. */}
      <p className="mono text-[9px] mt-1" data-testid="omega-bank-continuation"
        style={{ color: continuation ? 'var(--cw-amber)' : 'var(--cw-muted)' }}>
        {continuation
          ? `Ω.2b CONTINUATION: AR2 FIT ON ${continuation.corpus.toFixed(1)}s OF YOUR MOTION — SEAMS KEEP MOMENTUM`
          : 'Ω.2b CONTINUATION: GATED — UNDER 8s IN THE VAULT · SEAMS USE LINEAR BLEND'}
      </p>
    </div>
  );
};

/* Ω.3 — NEURAL CINEMA. The deterministic photographic finish (halation, film
   tone, grain-in-log, gate weave) plus the 2.5D novel view: freeze any frame
   into real depth geometry and dolly through it. Honest by design — the header
   states exactly which pass is running and which upgrade is gated. */
export const CinemaPanel = ({ strength, onStrength, onABDown, onABUp, onFreeze, still, onClearStill, disabled }) => (
  <div className="cw-panel" data-testid="omega-cinema-panel">
    <h2>◎ Neural Cinema</h2>
    <div className="cw-slider">
      <div className="lab"><span>Cinema Finish</span><b>{Math.round(strength * 100)}%</b></div>
      <input type="range" min={0} max={1} step={0.01} value={strength} disabled={disabled}
        data-testid="omega-cinema-strength" onChange={(e) => onStrength(parseFloat(e.target.value))} />
    </div>
    <div className="flex gap-1.5 mt-2">
      <button className="cw-chip flex-1" disabled={disabled || strength === 0}
        data-testid="omega-cinema-ab"
        onPointerDown={onABDown} onPointerUp={onABUp} onPointerLeave={onABUp}>
        <span>HOLD — A/B RAW RENDER</span>
      </button>
    </div>
    <div className="flex gap-1.5 mt-2">
      <button className="cw-chip flex-1" style={{ color: 'var(--cw-amber)' }} disabled={disabled}
        data-testid="omega-cinema-freeze" onClick={onFreeze}>
        <span>❄ FREEZE FRAME → 2.5D</span><small>DEPTH MESH</small>
      </button>
      {still && (
        <button className="cw-chip" style={{ padding: '8px 12px', color: 'var(--cw-red)' }}
          data-testid="omega-cinema-clear-still" onClick={onClearStill}>
          <span>✕ EXIT STILL</span>
        </button>
      )}
    </div>
    {still && (
      <p className="mono text-[9px] mt-2" style={{ color: 'var(--cw-amber)' }} data-testid="omega-cinema-still-state">
        STILL LOADED · SEEDED DOLLY #{still.seed} · SOURCE BADGE: STILL
      </p>
    )}
    <p className="mono text-[9px] mt-2" style={{ color: 'var(--cw-muted)' }}>
      DETERMINISTIC FILMIC PASS — HALATION · TONE · GRAIN · WEAVE. SD-TURBO IMG2IMG: GATED SLOT (WEBGPU), FALLBACK IS THIS PASS.
    </p>
  </div>
);

const SOURCE_COLOR = {
  performed: 'var(--cw-red)',
  stunt: 'var(--cw-red)',
  bank: 'var(--cw-amber)',
  synthetic: 'var(--cw-amber)',
  still: 'var(--cw-text-2)',
};

/* Ω.5 — THE EPISODE. An ordered cut assembled from many sources, with the
   continuity ledger surfaced inline: a broken cut is flagged before export. */
export const EpisodePanel = ({ shots, ledger, totalDur, selected, onAdd, onSelect, onMove, onRemove, onRender, onDownload, rendering, renderIdx, canAdd, phase, debt, onDismissDebt }) => {
  const flagsFor = (id) => ledger.filter((f) => f.shotId === id);
  return (
    <div className="cw-panel" data-testid="omega-episode-panel">
      <h2>▦ Episode — .veylep</h2>
      {/* Ω.0 — the render ledger surfaces an interrupted render truthfully:
         which cut, how far it got. Re-render is from the top, deterministic. */}
      {debt && !rendering && (
        <div className="mono text-[9px] mb-2 flex items-center gap-2" data-testid="omega-render-debt"
          style={{ color: 'var(--cw-amber)' }}>
          <span className="flex-1">
            ⚠ LAST RENDER OF “{(debt.name || 'EPISODE').toUpperCase()}” STOPPED AT SHOT {String((debt.done || 0) + 1).padStart(2, '0')}/{String(debt.shots || 0).padStart(2, '0')} — RE-RENDER IS FROM THE TOP, SAME FRAMES
          </span>
          <button className="underline" style={{ color: 'var(--cw-muted)' }}
            data-testid="omega-render-debt-dismiss" onClick={onDismissDebt}>DISMISS</button>
        </div>
      )}
      <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1 mb-2" data-testid="omega-shot-list">
        {shots.map((s, i) => {
          const flags = flagsFor(s.id);
          const isRendering = rendering && renderIdx === i;
          return (
            <div key={s.id}
              className={`cw-chip ${selected === s.id ? 'on' : ''}`}
              style={{ display: 'block', padding: '6px 8px', outline: isRendering ? '1px solid var(--cw-red)' : 'none' }}
              data-testid={`omega-shot-${i}`} onClick={() => onSelect(s.id)}>
              <div className="flex items-center gap-2">
                <span className="mono text-[9px]" style={{ color: 'var(--cw-muted)' }}>{String(i + 1).padStart(2, '0')}</span>
                <span className="mono text-[10px] truncate flex-1">{s.perfName}</span>
                <small style={{ color: SOURCE_COLOR[s.source] || 'var(--cw-amber)' }}>{s.source.toUpperCase()}</small>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="mono text-[9px] flex-1" style={{ color: 'var(--cw-text-2)' }}>
                  {s.still ? '2.5D DOLLY' : `${s.rig.toUpperCase()} · ${s.world.toUpperCase()}`} · {s.duration.toFixed(1)}s
                  {s.stunt ? ` · ⌁ ${s.stunt.key.toUpperCase()}` : ''}
                  {s.cinema > 0 ? ` · ◎ ${Math.round(s.cinema * 100)}%` : ''}
                </span>
                <button className="mono text-[10px]" style={{ color: 'var(--cw-muted)' }} disabled={i === 0}
                  data-testid={`omega-shot-up-${i}`} onClick={(e) => { e.stopPropagation(); onMove(i, -1); }}>▲</button>
                <button className="mono text-[10px]" style={{ color: 'var(--cw-muted)' }} disabled={i === shots.length - 1}
                  data-testid={`omega-shot-down-${i}`} onClick={(e) => { e.stopPropagation(); onMove(i, 1); }}>▼</button>
                <button className="mono text-[10px]" style={{ color: 'var(--cw-red)' }}
                  data-testid={`omega-shot-remove-${i}`} onClick={(e) => { e.stopPropagation(); onRemove(i); }}>✕</button>
              </div>
              {flags.map((f, fi) => (
                <p key={fi} className="mono text-[9px] mt-1"
                  style={{ color: f.level === 'warn' ? 'var(--cw-red)' : 'var(--cw-muted)' }}>
                  {f.level === 'warn' ? '⚠' : 'ℹ'} {f.rule}: {f.msg.toUpperCase()}
                </p>
              ))}
            </div>
          );
        })}
        {shots.length === 0 && (
          <p className="mono text-[9px]" style={{ color: 'var(--cw-muted)' }}>
            NO SHOTS — FRAME A SHOT ABOVE, THEN ADD IT TO THE CUT
          </p>
        )}
      </div>

      <button className="cw-chip w-full mb-1.5" style={{ color: 'var(--cw-amber)' }} disabled={!canAdd}
        data-testid="omega-episode-add" onClick={onAdd}>
        <span>+ ADD CURRENT SHOT TO CUT</span><small>{shots.length} SHOTS · {totalDur.toFixed(1)}s</small>
      </button>
      <div className="flex gap-1.5">
        <button className="cw-rec flex-1" disabled={shots.length === 0 || rendering}
          data-testid="omega-episode-render" onClick={onRender}>
          {rendering
            ? phase === 'breather'
              ? '● BREATHER — RECORDER PAUSED'
              : `● SHOT ${String((renderIdx || 0) + 1).padStart(2, '0')}/${String(shots.length).padStart(2, '0')}`
            : '● RENDER EPISODE'}
        </button>
        <button className="cw-chip" style={{ padding: '8px 12px' }} disabled={shots.length === 0}
          data-testid="omega-episode-download" onClick={onDownload}>
          <span>⇩ .VEYLEP</span>
        </button>
      </div>
      <p className="mono text-[9px] mt-2" style={{ color: 'var(--cw-muted)' }}>
        ONE CONTINUOUS RENDER ACROSS EVERY SOURCE · CONTINUITY ENFORCED, NOT HOPED FOR
      </p>
    </div>
  );
};


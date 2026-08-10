import { WORLDS } from '../../studio/worlds';
import { VOICE_PRESETS } from '../../studio/voice';

export const ScenePanel = ({ world, onWorld }) => (
  <div className="cw-panel" data-testid="scene-panel">
    <h2>◈ Space Worlds</h2>
    <div className="grid grid-cols-1 gap-1.5">
      {WORLDS.map((w) => (
        <div key={w.key} className={`cw-chip ${world === w.key ? 'on' : ''}`}
          data-testid={`scene-${w.key}`} onClick={() => onWorld(w.key)}>
          <span>{w.name}</span><small>KEY {w.hotkey}</small>
        </div>
      ))}
    </div>
  </div>
);

const EXPRESSIONS = [
  { key: 'calm', name: 'CALM', hk: 'Q' },
  { key: 'fury', name: 'FURY', hk: 'W' },
  { key: 'narrow', name: 'NARROW', hk: 'E' },
  { key: 'shock', name: 'SHOCK', hk: 'R' },
  { key: 'smirk', name: 'SMIRK', hk: 'T' },
];

export const ExpressionPanel = ({ expr, onExpr, onGlitch }) => (
  <div className="cw-panel" data-testid="expression-panel">
    <h2>◬ Expression</h2>
    <div className="grid grid-cols-2 gap-1.5">
      {EXPRESSIONS.map((e) => (
        <div key={e.key} className={`cw-chip ${expr === e.key ? 'on' : ''}`}
          data-testid={`expr-${e.key}`} onClick={() => onExpr(e.key)}>
          <span>{e.name}</span><small>{e.hk}</small>
        </div>
      ))}
      <div className="cw-chip" data-testid="glitch-burst-btn" onClick={onGlitch}
        style={{ color: 'var(--cw-amber)' }}>
        <span>⚡ GLITCH</span><small>G</small>
      </div>
    </div>
  </div>
);

const SLIDERS = [
  { key: 'pitch', label: 'Pitch Shift', min: -7, max: 0, step: 0.5, fmt: (v) => `${v} st` },
  { key: 'sub', label: 'Sub-Octave', min: 0, max: 0.6, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'reverb', label: 'Void Reverb', min: 0, max: 0.5, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'static', label: 'Comms Static', min: 0, max: 0.1, step: 0.005, fmt: (v) => `${Math.round(v * 1000)}` },
  { key: 'drive', label: 'Signal Drive', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
];

export const VoicePanel = ({ params, preset, onPreset, onParam, monitor, onMonitor, level, micOk }) => (
  <div className="cw-panel" data-testid="voice-panel">
    <h2>◪ Voice Of The Void</h2>
    <div className="flex flex-wrap gap-1.5 mb-3">
      {Object.entries(VOICE_PRESETS).map(([k, p]) => (
        <div key={k} className={`cw-chip ${preset === k ? 'on' : ''}`} style={{ padding: '5px 8px', fontSize: 9 }}
          data-testid={`voice-preset-${k}`} onClick={() => onPreset(k)}>
          {p.label}
        </div>
      ))}
    </div>
    {SLIDERS.map((s) => (
      <div className="cw-slider" key={s.key}>
        <div className="lab"><span>{s.label}</span><b>{s.fmt(params[s.key])}</b></div>
        <input type="range" min={s.min} max={s.max} step={s.step} value={params[s.key]}
          data-testid={`voice-slider-${s.key}`}
          onChange={(e) => onParam(s.key, parseFloat(e.target.value))} />
      </div>
    ))}
    <label className="flex items-center gap-2 mono text-[10px] text-[color:var(--cw-text-2)] cursor-pointer mt-1">
      <input type="checkbox" checked={monitor} data-testid="monitor-checkbox"
        onChange={(e) => onMonitor(e.target.checked)} />
      MONITOR (HEADPHONES!)
    </label>
    <div className="cw-meter mt-3" data-testid="voice-meter">
      <div style={{ width: `${Math.min(100, level * 130)}%` }} />
    </div>
    {!micOk && <div className="mono text-[9px] mt-2" style={{ color: 'var(--cw-amber)' }}>MIC OFFLINE — video-only recording</div>}
  </div>
);

export const StatusPanel = ({ tracking, micOk, fps, mode }) => {
  const dot = (ok) => `cw-dot ${mode === 'sim' ? 'warn' : ok ? 'ok' : 'err'}`;
  return (
    <div className="cw-panel" data-testid="status-panel">
      <h2>◍ Rig Telemetry</h2>
      <div className="mono text-[10px] space-y-2 text-[color:var(--cw-text-2)]">
        <div className="flex items-center gap-2" data-testid="status-face"><span className={dot(tracking.face)} />FACE TRACK {mode === 'sim' ? '· SIM' : tracking.face ? '· LOCKED' : '· SEARCHING'}</div>
        <div className="flex items-center gap-2" data-testid="status-pose"><span className={dot(tracking.pose)} />BODY TRACK {mode === 'sim' ? '· SIM' : tracking.pose ? '· LOCKED' : '· SEARCHING'}</div>
        <div className="flex items-center gap-2" data-testid="status-hands"><span className={dot(tracking.hands)} />AI MATTE {mode === 'sim' ? '· SIM' : tracking.hands ? '· LOCKED' : '· SEARCHING'}</div>
        <div className="flex items-center gap-2" data-testid="status-voice"><span className={`cw-dot ${micOk ? 'ok' : 'err'}`} />VOICE ENGINE {micOk ? '· ONLINE' : '· OFFLINE'}</div>
        <div className="flex items-center justify-between pt-1" style={{ borderTop: '1px solid var(--cw-border)' }}>
          <span>RENDER</span><span style={{ color: 'var(--cw-cyan)' }} data-testid="fps-readout">{fps} FPS</span>
        </div>
      </div>
    </div>
  );
};

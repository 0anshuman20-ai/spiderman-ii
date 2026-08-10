/* THE OMEGA ROOM — Ω.1 + Ω.4 live in here.

   No webcam, no matte, no live loop. A `.veyl` Performance File from the Vault
   (or a forged synthetic take) drives the Synthetic Actor inside a real 3D world,
   framed by a free camera rig — and the Stunt Engine can seize the body inside a
   takeover window: verlet web-line physics, baked at construction, identical on
   every re-render, scrubbable like any other clip. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createOmegaStage, RIG_BY_KEY } from '../studio/omegaStage';
import { createStunt, STUNT_PRESETS } from '../studio/stunt';
import { synthesizePerformance } from '../studio/perf';
import { vault, PERFORMANCES } from '../studio/vault';
import { Recorder } from '../studio/recorder';
import { SourcePanel, RigPanel, OmegaWorldPanel, StuntPanel } from '../components/studio/OmegaPanels';

const STUNT_BY_KEY = STUNT_PRESETS.reduce((m, s) => { m[s.key] = s; return m; }, {});
const FORGE_BEATS = [
  ['settle', 'turn', 'reach', 'cast', 'recoil', 'settle'],
  ['settle', 'point', 'brace', 'cast', 'settle'],
  ['turn', 'reach', 'recoil', 'brace', 'settle'],
];

export default function OmegaRoom() {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const recorderRef = useRef(new Recorder());
  const forgeSeed = useRef(11);

  const [perfs, setPerfs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [rig, setRig] = useState('medium');
  const [world, setWorld] = useState('nebula-drift');
  const [stunt, setStunt] = useState(null);
  const [stuntStart, setStuntStart] = useState(1.2);
  const [stuntLen, setStuntLen] = useState(2.8);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [ready, setReady] = useState(false);

  /* boot: stage + vault. If the vault is empty, forge a first synthetic take so
     the room (and the Stunt Engine) works on day one with no camera ever opened. */
  useEffect(() => {
    const stage = createOmegaStage(canvasRef.current);
    stageRef.current = stage;
    let alive = true;
    (async () => {
      let list = await vault.all(PERFORMANCES);
      if (list.length === 0) {
        const first = synthesizePerformance({ name: 'forged-take-01', beats: FORGE_BEATS[0], world: 'nebula-drift', seed: 7 });
        await vault.put(PERFORMANCES, first);
        list = [first];
      }
      if (!alive) return;
      setPerfs(list);
      setActiveId(list[0].id);
      setWorld(list[0].world || 'nebula-drift');
      setReady(true);
    })();
    return () => { alive = false; stage.dispose(); };
  }, []);

  /* one function rebuilds the shot from current state — deterministic by design */
  const loadShot = useCallback(async (opts = {}) => {
    const stage = stageRef.current;
    if (!stage) return;
    const id = opts.activeId !== undefined ? opts.activeId : activeId;
    const rigKey = opts.rig || rig;
    const worldKey = opts.world || world;
    const stuntKey = opts.stunt !== undefined ? opts.stunt : stunt;
    const t0 = opts.stuntStart !== undefined ? opts.stuntStart : stuntStart;
    const len = opts.stuntLen !== undefined ? opts.stuntLen : stuntLen;

    const perf = id ? await vault.get(PERFORMANCES, id) : null;
    const dur = perf ? perf.duration : 6;
    let solver = null;
    let label = perf ? (perf.source === 'performed' ? 'performed' : 'synthetic') : 'synthetic';
    if (stuntKey && STUNT_BY_KEY[stuntKey]) {
      const s0 = Math.max(0, Math.min(dur - 1.2, t0));
      const s1 = Math.min(dur - 0.05, s0 + len);
      solver = createStunt(STUNT_BY_KEY[stuntKey].make(s0, s1));
      label = `stunt · ${STUNT_BY_KEY[stuntKey].name.toLowerCase()}`;
    }
    stage.load({
      performance: perf, rig: rigKey, world: worldKey,
      in: 0, out: dur, stunt: solver,
      label: `${label} · ${(RIG_BY_KEY[rigKey] || RIG_BY_KEY.medium).badge}`,
    });
    setDuration(stage.duration);
    setTime(0);
    setPlaying(false);
  }, [activeId, rig, world, stunt, stuntStart, stuntLen]);

  useEffect(() => { if (ready) loadShot(); }, [ready, loadShot]);

  const play = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || stage.playing) { stage && stage.pause(); setPlaying(false); return; }
    setPlaying(true);
    stage.play({
      onTick: (t) => setTime(t),
      onEnd: () => { setPlaying(false); setTime(stageRef.current.duration); },
    });
  }, []);

  const seek = useCallback((t) => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.pause(); setPlaying(false);
    stage.seek(t); setTime(t);
  }, []);

  const forge = useCallback(async () => {
    const seed = forgeSeed.current += 6;
    const beats = FORGE_BEATS[seed % FORGE_BEATS.length];
    const perf = synthesizePerformance({
      name: `forged-take-${String(seed).padStart(2, '0')}`, beats, world, seed,
    });
    await vault.put(PERFORMANCES, perf);
    const list = await vault.all(PERFORMANCES);
    setPerfs(list);
    setActiveId(perf.id);
  }, [world]);

  /* offline render: play the shot once into MediaRecorder. Same clock, same bake,
     same frames — the export IS the preview, at full quality. */
  const exportShot = useCallback(() => {
    const stage = stageRef.current;
    const rec = recorderRef.current;
    if (!stage || rec.recording || exporting) return;
    setExporting(true);
    stage.pause(); stage.seek(0); setTime(0);
    rec.start(stage, null);
    setPlaying(true);
    stage.play({
      onTick: (t) => setTime(t),
      onEnd: async () => {
        setPlaying(false);
        const take = await rec.stop();
        setExporting(false);
        if (take) {
          const a = document.createElement('a');
          a.href = take.url;
          a.download = `omega-${stunt ? stunt : 'shot'}-${rig}.${take.ext || 'webm'}`;
          a.click();
        }
      },
    });
  }, [exporting, rig, stunt]);

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`;

  return (
    <div className="min-h-screen" data-testid="omega-root">
      <header className="flex items-center gap-4 px-4 py-2.5" style={{ borderBottom: '1px solid var(--cw-border)' }}>
        <span className="mono font-bold text-sm tracking-widest" data-testid="omega-brand">
          COSMIC WEAVER <span style={{ color: 'var(--cw-red)' }}>// OMEGA ROOM</span>
        </span>
        <span className="mono text-[9px] hidden md:inline" style={{ color: 'var(--cw-muted)' }}>
          SYNTHETIC ACTOR · STUNT ENGINE · NO CAMERA REQUIRED
        </span>
        <div className="flex-1" />
        <Link to="/" className="cw-chip" style={{ padding: '8px 14px', textDecoration: 'none' }} data-testid="omega-back-link">
          <span>← LIVE STUDIO</span>
        </Link>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-12 gap-3 p-3">
        {/* left rail: what drives the body, where it stands */}
        <div className="lg:col-span-3 space-y-3 order-2 lg:order-1">
          <SourcePanel perfs={perfs} activeId={activeId} memoryOnly={vault.isMemoryOnly}
            onPick={(id) => setActiveId(id)} onForge={forge} />
          <OmegaWorldPanel world={world} onWorld={setWorld} />
        </div>

        {/* viewport + transport */}
        <div className="lg:col-span-5 order-1 lg:order-2">
          <div className="cw-viewport mx-auto" style={{ aspectRatio: '9/16', maxHeight: 'calc(100vh - 150px)' }} data-testid="omega-viewport">
            <canvas ref={canvasRef} width={1080} height={1920} data-testid="omega-canvas" />
            <div className="cw-scanlines" />
          </div>
          <div className="flex items-center gap-3 mt-2 px-1" data-testid="omega-transport">
            <button className={`cw-rec ${playing ? 'live' : ''}`} disabled={!ready || exporting}
              data-testid="omega-play-btn" onClick={play}>
              {playing ? '❚❚' : '▶'}
            </button>
            <span className="mono text-[10px] w-20" style={{ color: 'var(--cw-text-2)' }} data-testid="omega-clock">
              {fmt(time)}
            </span>
            <input type="range" className="flex-1" min={0} max={Math.max(0.1, duration)} step={0.033}
              value={Math.min(time, duration)} data-testid="omega-scrub"
              onChange={(e) => seek(parseFloat(e.target.value))} />
            <span className="mono text-[10px]" style={{ color: 'var(--cw-muted)' }}>{fmt(duration)}</span>
          </div>
        </div>

        {/* right rail: the camera and the physics */}
        <div className="lg:col-span-4 space-y-3 order-3">
          <RigPanel rig={rig} onRig={setRig} />
          <StuntPanel stunt={stunt} onStunt={setStunt} dur={duration || 6}
            start={stuntStart} len={stuntLen} onStart={setStuntStart} onLen={setStuntLen} />
          <div className="cw-panel" data-testid="omega-export-panel">
            <h2>⇩ Render Shot</h2>
            <button className="cw-rec w-full" disabled={!ready || exporting || playing}
              data-testid="omega-export-btn" onClick={exportShot}>
              {exporting ? '● RENDERING…' : '● RENDER & DOWNLOAD'}
            </button>
            <p className="mono text-[9px] mt-2" style={{ color: 'var(--cw-muted)' }}>
              1080×1920 · SOURCE BADGE BURNED IN · DETERMINISTIC RE-RENDER
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

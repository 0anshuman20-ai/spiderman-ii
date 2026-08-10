import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { createStage } from '../studio/stage';
import { Tracker, makeRig } from '../studio/tracking';
import { VoiceEngine } from '../studio/voice';
import { Recorder } from '../studio/recorder';
import { EMOTE_TO_EXPR } from '../studio/scripts';
import { ScenePanel, ExpressionPanel, VoicePanel, StatusPanel } from '../components/studio/Panels';
import { ScriptLog, Prompter } from '../components/studio/Teleprompter';
import { TakesPanel } from '../components/studio/TakesPanel';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const FX_MAP = {
  glitch: (stage, voice) => { stage.glitch(0.45); voice.triggerGlitch(250); },
  zoom: (stage) => stage.punch(),
  flare: (stage) => stage.punch(),
  shake: (stage) => stage.glitch(0.2),
  static: (stage, voice) => voice.triggerGlitch(140),
  pulse: (stage) => stage.punch(),
  none: () => {},
};

export default function Studio() {
  const canvasRef = useRef(null);
  const pipRef = useRef(null);
  const stageRef = useRef(null);
  const rigRef = useRef(makeRig());
  const trackerRef = useRef(null);
  const voiceRef = useRef(null);
  const recorderRef = useRef(new Recorder());
  const scriptRef = useRef(null);
  const beatRef = useRef(0);
  const recStartRef = useRef(0);

  const [booted, setBooted] = useState(null); // null | 'live' | 'sim'
  const [booting, setBooting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [world, setWorldState] = useState('nebula-drift');
  const [expr, setExprState] = useState('calm');
  const [preset, setPresetState] = useState('veyl-core');
  const [voiceParams, setVoiceParams] = useState({ pitch: -3, sub: 0.3, reverb: 0.18, static: 0.015, drive: 0.2 });
  const [monitor, setMonitor] = useState(false);
  const [level, setLevel] = useState(0);
  const [micOk, setMicOk] = useState(false);
  const [tracking, setTracking] = useState({ face: false, pose: false, hands: false });
  const [fps, setFps] = useState(0);
  const [takes, setTakes] = useState([]);
  const [activeScript, setActiveScript] = useState(null);
  const [beatIdx, setBeatIdx] = useState(0);
  const [progress, setProgress] = useState({});
  const [pipOn, setPipOn] = useState(true);
  const [glitchUi, setGlitchUi] = useState(false);

  useEffect(() => {
    axios.get(`${API}/progress`).then((r) => setProgress(r.data)).catch(() => {});
  }, []);

  // attach webcam PIP once the element mounts (live mode only)
  useEffect(() => {
    if (booted === 'live' && pipOn && pipRef.current && trackerRef.current && trackerRef.current.stream) {
      pipRef.current.srcObject = trackerRef.current.stream;
    }
  }, [booted, pipOn]);

  const setWorld = useCallback((k) => {
    setWorldState(k);
    if (stageRef.current) stageRef.current.setWorld(k);
  }, []);

  const setExpr = useCallback((e) => {
    setExprState(e);
    rigRef.current.expression = e;
  }, []);

  const doGlitch = useCallback(() => {
    if (stageRef.current) stageRef.current.glitch(0.45);
    if (voiceRef.current) voiceRef.current.triggerGlitch(250);
    setGlitchUi(true);
    setTimeout(() => setGlitchUi(false), 700);
  }, []);

  const boot = useCallback(async (mode) => {
    setBooting(true);
    const rig = rigRef.current;
    const stage = createStage(canvasRef.current);
    stageRef.current = stage;
    const tracker = new Tracker(rig);
    trackerRef.current = tracker;
    const voice = new VoiceEngine({});
    voiceRef.current = voice;

    if (mode === 'live') {
      const [camOk, audioOk] = await Promise.all([tracker.init(), voice.init()]);
      if (!camOk) tracker.startSim();
      setMicOk(audioOk);
      if (audioOk) await voice.resume();
      setBooted(camOk ? 'live' : 'sim');
    } else {
      tracker.startSim();
      const audioOk = await voice.init().catch(() => false);
      setMicOk(!!audioOk);
      setBooted('sim');
    }

    stage.start(rig, tracker, (t, dt) => {
      tracker.tick(t, dt);
      if (voice.ready && rig.tracking.mode !== 'sim') {
        rig.level += (Math.min(1, Math.max(voice.level.rms * 4, voice.outputLevel())) - rig.level) * 0.35;
      }
      // auto-perform teleprompter cues while recording
      const script = scriptRef.current;
      if (script && recorderRef.current.recording) {
        const el = (performance.now() - recStartRef.current) / 1000;
        let idx = 0;
        for (let i = 0; i < script.beats.length; i++) if (el >= script.beats[i].t) idx = i;
        if (idx !== beatRef.current) {
          beatRef.current = idx;
          const b = script.beats[idx];
          rig.expression = EMOTE_TO_EXPR[b.emote] || 'calm';
          (FX_MAP[b.fx] || FX_MAP.none)(stage, voice);
        }
      }
    });
    setBooting(false);
  }, []);

  // UI telemetry poll
  useEffect(() => {
    if (!booted) return undefined;
    const id = setInterval(() => {
      const rig = rigRef.current;
      setTracking({ ...rig.tracking });
      setFps(rig.tracking.fps);
      setLevel(rig.level);
      setExprState(rig.expression);
      if (recorderRef.current.recording) {
        const el = recorderRef.current.elapsed;
        setElapsed(el);
        if (scriptRef.current) setBeatIdx(beatRef.current);
      }
    }, 200);
    return () => clearInterval(id);
  }, [booted]);

  const toggleRec = useCallback(async () => {
    const rec = recorderRef.current;
    const stage = stageRef.current;
    if (!stage) return;
    if (!rec.recording) {
      const script = scriptRef.current;
      stage.setHud(script ? `COSMIC WEAVER ── TRANSMISSION #${String(script.number).padStart(2, '0')}` : 'COSMIC WEAVER ── LIVE');
      beatRef.current = 0; setBeatIdx(0);
      recStartRef.current = performance.now();
      rec.start(stage, voiceRef.current && voiceRef.current.ready ? voiceRef.current.stream : null);
      setRecording(true);
    } else {
      const take = await rec.stop();
      setRecording(false); setElapsed(0);
      stage.setHud('COSMIC WEAVER ── STANDBY');
      if (take) {
        const script = scriptRef.current;
        const name = script ? `transmission-${String(script.number).padStart(2, '0')}-take` : 'veyl-freestyle-take';
        const entry = { ...take, id: `${Date.now()}`, name: `${name}-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}` };
        setTakes((p) => [entry, ...p]);
        // auto-download
        const a = document.createElement('a');
        a.href = take.url; a.download = `${entry.name}.webm`; a.click();
        axios.post(`${API}/takes`, {
          name: entry.name, transmission: script ? script.number : null,
          world: stage.worldKey, duration: take.duration, size: take.size, mime: take.mime,
        }).catch(() => {});
        if (script) {
          axios.post(`${API}/progress/${script.number}`, { recorded: true }).catch(() => {});
          setProgress((p) => ({ ...p, [script.number]: true }));
        }
      }
    }
  }, []);

  const pickScript = useCallback((s) => {
    scriptRef.current = s;
    setActiveScript(s);
    setBeatIdx(0); beatRef.current = 0;
    setWorld(s.world);
    if (stageRef.current) stageRef.current.setHud(`COSMIC WEAVER ── TRANSMISSION #${String(s.number).padStart(2, '0')}`);
  }, [setWorld]);

  const closeScript = useCallback(() => {
    scriptRef.current = null; setActiveScript(null);
    if (stageRef.current) stageRef.current.setHud('COSMIC WEAVER ── STANDBY');
  }, []);

  // hotkeys
  useEffect(() => {
    if (!booted) return undefined;
    const worldKeys = { 1: 'nebula-drift', 2: 'red-planet', 3: 'derelict-station', 4: 'asteroid-earth', 5: 'dying-star' };
    const exprKeys = { q: 'calm', w: 'fury', e: 'narrow', r: 'shock', t: 'smirk' };
    const onKey = (ev) => {
      if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA') return;
      const k = ev.key.toLowerCase();
      if (worldKeys[k]) setWorld(worldKeys[k]);
      else if (exprKeys[k]) setExpr(exprKeys[k]);
      else if (k === 'g') doGlitch();
      else if (k === ' ') { ev.preventDefault(); toggleRec(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [booted, setWorld, setExpr, doGlitch, toggleRec]);

  const onParam = useCallback((k, v) => {
    setVoiceParams((p) => ({ ...p, [k]: v }));
    if (voiceRef.current) voiceRef.current.setParam(k, v);
  }, []);
  const onPreset = useCallback((k) => {
    setPresetState(k);
    if (voiceRef.current) {
      voiceRef.current.setPreset(k);
      setVoiceParams({ ...voiceRef.current.params });
    }
  }, []);
  const onMonitor = useCallback((on) => {
    setMonitor(on);
    if (voiceRef.current) voiceRef.current.setMonitor(on);
  }, []);

  const fmtClock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  return (
    <div className={`min-h-screen ${glitchUi ? 'cw-glitching' : ''}`} data-testid="studio-root">
      {/* boot overlay */}
      {!booted && (
        <div className="cw-boot" data-testid="boot-overlay">
          <div className="cw-boot-inner">
            <div className="mono text-[10px] mb-3" style={{ color: 'var(--cw-red)', letterSpacing: '0.3em' }}>SIGNAL ORIGIN: UNKNOWN SECTOR</div>
            <h1 className="mono text-4xl sm:text-5xl font-bold mb-2 tracking-tight">COSMIC<br />WEAVER</h1>
            <p className="text-sm mb-1" style={{ color: 'var(--cw-text-2)' }}>AR suit studio — the suit is painted onto YOUR real video. Your mouth, blinks and every move stay yours. AI matting drops you into deep space.</p>
            <p className="mono text-[10px] mb-8" style={{ color: 'var(--cw-muted)' }}>REAL VIDEO SUIT · AI BACKGROUND MATTE — 1080×1920 · 60FPS · $0</p>
            <div className="flex flex-col gap-3 items-start">
              <button className="cw-rec" data-testid="boot-live-btn" disabled={booting}
                onClick={() => boot('live')}>{booting ? 'INITIALIZING…' : '● INITIALIZE FULL RIG'}</button>
              <button className="cw-chip" style={{ padding: '10px 18px' }} data-testid="boot-sim-btn" disabled={booting}
                onClick={() => boot('sim')}><span>RUN SIM MODE — NO CAMERA</span></button>
            </div>
            <p className="mono text-[9px] mt-8" style={{ color: 'var(--cw-muted)' }}>ALLOW CAMERA + MIC WHEN ASKED · WEAR HEADPHONES IF MONITORING</p>
          </div>
        </div>
      )}

      {/* header */}
      <header className="flex items-center gap-4 px-4 py-2.5" style={{ borderBottom: '1px solid var(--cw-border)' }}>
        <span className="mono font-bold text-sm tracking-widest" data-testid="header-brand">COSMIC WEAVER <span style={{ color: 'var(--cw-red)' }}>// VEYL STUDIO</span></span>
        <span className="mono text-[9px] hidden md:inline" style={{ color: 'var(--cw-muted)' }}>
          {booted === 'sim' ? 'SIM PERFORMER' : booted === 'live' ? 'LIVE TRACKING' : 'OFFLINE'}
        </span>
        <div className="flex-1" />
        {recording && <span className="mono text-sm" style={{ color: 'var(--cw-red)' }} data-testid="rec-timer">● {fmtClock(elapsed)}</span>}
        <button className={`cw-rec ${recording ? 'live' : ''}`} disabled={!booted} data-testid="record-btn" onClick={toggleRec}>
          {recording ? '■ STOP & SAVE' : '● REC'}
        </button>
      </header>

      {/* main grid */}
      <main className="grid grid-cols-1 lg:grid-cols-12 gap-3 p-3">
        {/* left rail */}
        <div className="lg:col-span-3 space-y-3 order-2 lg:order-1">
          <VoicePanel params={voiceParams} preset={preset} onPreset={onPreset} onParam={onParam}
            monitor={monitor} onMonitor={onMonitor} level={level} micOk={micOk} />
          <ScenePanel world={world} onWorld={setWorld} />
          <ExpressionPanel expr={expr} onExpr={setExpr} onGlitch={doGlitch} />
        </div>

        {/* viewport */}
        <div className="lg:col-span-5 order-1 lg:order-2">
          <div className={`cw-viewport mx-auto ${recording ? 'live' : ''}`} style={{ aspectRatio: '9/16', maxHeight: 'calc(100vh - 90px)' }} data-testid="viewport">
            <canvas ref={canvasRef} width={1080} height={1920} data-testid="stage-canvas" />
            <div className="cw-scanlines" />
            {booted === 'live' && pipOn && (
              <video ref={pipRef} className="cw-pip" autoPlay muted playsInline data-testid="pip-preview" />
            )}
            <button className="mono absolute top-2 right-2 text-[9px] bg-black/60 border px-2 py-1 cursor-pointer z-10"
              style={{ borderColor: 'var(--cw-border)', color: 'var(--cw-muted)' }}
              data-testid="pip-toggle" onClick={() => setPipOn((p) => !p)}>PIP {pipOn ? 'ON' : 'OFF'}</button>
            <Prompter script={activeScript} beatIdx={beatIdx} recording={recording} elapsed={elapsed} onClose={closeScript} />
          </div>
        </div>

        {/* right rail */}
        <div className="lg:col-span-4 space-y-3 order-3 flex flex-col">
          <StatusPanel tracking={tracking} micOk={micOk} fps={fps} mode={booted === 'sim' ? 'sim' : rigRef.current.tracking.mode} />
          <ScriptLog active={activeScript} onPick={pickScript} progress={progress} />
          <TakesPanel takes={takes} onDelete={(id) => {
            setTakes((p) => p.filter((t) => t.id !== id));
            axios.delete(`${API}/takes/${id}`).catch(() => {});
          }} />
        </div>
      </main>
    </div>
  );
}


import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { createStage } from '../studio/stage';
import { PerfRecorder } from '../studio/perf';
import { vault, PERFORMANCES } from '../studio/vault';
import { Tracker, makeRig } from '../studio/tracking';
import { SpideyVoice } from '../studio/spideyVoice';
import { Recorder } from '../studio/recorder';
import { MusicEngine } from '../studio/music';
import { EMOTE_TO_EXPR } from '../studio/scripts';
import { DEFAULT_WORLD_PARAMS } from '../studio/worlds';
import { readActiveParams, writeActiveParams, readPresets, savePreset, deletePreset, isDefaultParams } from '../studio/worldPresets';
import { ScenePanel, ExpressionPanel, VoicePanel, StatusPanel, MusicPanel, WorldEditorPanel } from '../components/studio/Panels';
import { ScriptLog, Prompter } from '../components/studio/Teleprompter';
import { TakesPanel } from '../components/studio/TakesPanel';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const FX_MAP = {
  glitch: (stage, voice, music) => { stage.glitch(0.45); voice.triggerGlitch(250); if (music) music.glitchZap(); },
  zoom: (stage, voice, music) => { stage.punch(); if (music) music.impact(); },
  flare: (stage, voice, music) => { stage.punch(); if (music) music.riser(900); },
  shake: (stage, voice, music) => { stage.glitch(0.2); if (music) music.whoosh(500); },
  static: (stage, voice, music) => { voice.triggerGlitch(140); if (music) music.glitchZap(); },
  pulse: (stage, voice, music) => { stage.punch(); if (music) music.impact(); },
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
  const perfRecRef = useRef(new PerfRecorder());
  const musicRef = useRef(null);
  const scriptRef = useRef(null);
  const beatRef = useRef(0);
  const recStartRef = useRef(0);
  const countdownRef = useRef(null);   // interval id while the 3-2-1 runs
  const captionsRef = useRef(false);   // mirrored into the frame callback — OFF: clean uploads
  const paramsTimerRef = useRef(null); // debounce for world-editor rebuilds

  const [booted, setBooted] = useState(null); // null | 'live' | 'sim'
  const [booting, setBooting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [world, setWorldState] = useState('nebula-drift');
  const [expr, setExprState] = useState('calm');
  const [monitor, setMonitor] = useState(false);
  const [level, setLevel] = useState(0);
  const [micOk, setMicOk] = useState(false); // = spider-voice engine online (mic is never used)
  // SPIDER VOICE — script-first: the script is synthesized BEFORE any take
  const [voiceUi, setVoiceUi] = useState({ synthState: 'empty', lines: [], currentLine: -1, nextLine: 0 });
  const [scriptOpen, setScriptOpen] = useState(false);
  const [scriptText, setScriptText] = useState('');
  const [synthProg, setSynthProg] = useState(null); // null | { done, total }
  const [tracking, setTracking] = useState({ face: false, pose: false, hands: false });
  const [fps, setFps] = useState(0);
  const [takes, setTakes] = useState([]);
  const [activeScript, setActiveScript] = useState(null);
  const [beatIdx, setBeatIdx] = useState(0);
  const [progress, setProgress] = useState({});
  const [pipOn, setPipOn] = useState(true);
  const [glitchUi, setGlitchUi] = useState(false);
  const [countdown, setCountdown] = useState(null); // null | 3 | 2 | 1
  const [captionsOn, setCaptionsOn] = useState(false); // default OFF: nothing written into the video
  // sound layer UI
  const [musicOn, setMusicOn] = useState(true);
  const [musicReady, setMusicReady] = useState(false);
  const [bedVol, setBedVol] = useState(1);
  const [sfxVol, setSfxVol] = useState(1);
  const [musicMonitor, setMusicMonitor] = useState(true);
  // world editor
  const [wParams, setWParams] = useState({ ...DEFAULT_WORLD_PARAMS });
  const [wPresets, setWPresets] = useState(() => readPresets('nebula-drift'));

  useEffect(() => {
    axios.get(`${API}/progress`).then((r) => setProgress(r.data)).catch(() => {});
  }, []);

  // unmount (e.g. navigating to the Omega Room): silence the score, drop the countdown
  useEffect(() => () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (paramsTimerRef.current) clearTimeout(paramsTimerRef.current);
    if (musicRef.current) { try { musicRef.current.dispose(); } catch (_) {} }
    if (voiceRef.current) { try { voiceRef.current.dispose(); } catch (_) {} }
    if (stageRef.current) { try { stageRef.current.dispose(); } catch (_) {} }
  }, []);

  // attach webcam PIP once the element mounts (live mode only)
  useEffect(() => {
    if (booted === 'live' && pipOn && pipRef.current && trackerRef.current && trackerRef.current.stream) {
      pipRef.current.srcObject = trackerRef.current.stream;
    }
  }, [booted, pipOn]);

  const setWorld = useCallback((k) => {
    setWorldState(k);
    const saved = readActiveParams(k);
    setWParams(saved ? { ...saved } : { ...DEFAULT_WORLD_PARAMS });
    setWPresets(readPresets(k));
    if (stageRef.current) stageRef.current.setWorld(k, saved);
    if (musicRef.current) musicRef.current.setWorld(k);
  }, []);

  /* WORLD EDITOR — debounce slider moves into one rebuild, persist the dial */
  const onWorldParam = useCallback((key, value) => {
    setWParams((prev) => {
      const next = { ...prev, [key]: value };
      writeActiveParams(stageRef.current ? stageRef.current.worldKey : 'nebula-drift', next);
      if (paramsTimerRef.current) clearTimeout(paramsTimerRef.current);
      paramsTimerRef.current = setTimeout(() => {
        if (stageRef.current) stageRef.current.setWorldParams(isDefaultParams(next) ? null : next);
      }, 180);
      return next;
    });
  }, []);

  const applyWorldParams = useCallback((params) => {
    const k = stageRef.current ? stageRef.current.worldKey : 'nebula-drift';
    const next = { ...DEFAULT_WORLD_PARAMS, ...(params || {}) };
    setWParams(next);
    writeActiveParams(k, next);
    if (stageRef.current) stageRef.current.setWorldParams(isDefaultParams(next) ? null : next);
  }, []);

  const setExpr = useCallback((e) => {
    setExprState(e);
    rigRef.current.expression = e;
  }, []);

  const doGlitch = useCallback(() => {
    if (stageRef.current) stageRef.current.glitch(0.45);
    if (voiceRef.current) voiceRef.current.triggerGlitch(250);
    if (musicRef.current) musicRef.current.glitchZap();
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
    // SPIDER VOICE — 100% synthesized, getUserMedia(audio) is NEVER called
    const voice = new SpideyVoice({});
    voiceRef.current = voice;

    if (mode === 'live') {
      const [camOk, audioOk] = await Promise.all([tracker.init(), voice.init()]);
      if (!camOk) tracker.startSim();
      setMicOk(!!audioOk);
      if (audioOk) await voice.resume();
      setBooted(camOk ? 'live' : 'sim');
    } else {
      tracker.startSim();
      const audioOk = await voice.init().catch(() => false);
      setMicOk(!!audioOk);
      setBooted('sim');
    }

    // THE SOUND LAYER — borrows the voice ctx when the mic came up, else owns its own.
    // Boot is a user gesture, so the context is allowed to start here.
    const music = new MusicEngine(voice);
    musicRef.current = music;
    if (music.init()) {
      await music.resume();
      music.setWorld(stage.worldKey);
      setMusicReady(true);
    }

    stage.start(rig, tracker, (t, dt) => {
      tracker.tick(t, dt);
        // Inversion 1: the take is a rig timeline — sample it beside the video
      perfRecRef.current.sample(dt, rig, tracker);
      /* the lip watcher: your jaw is the trigger — the engine already knows the
         script, so the pre-voiced line fires the instant your mouth opens */
      voice.update(dt, rig.jaw, recorderRef.current.recording);
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
          (FX_MAP[b.fx] || FX_MAP.none)(stage, voice, musicRef.current);
          // caption burn-in: the beat line lands in the composited frame itself
          if (captionsRef.current) stage.setCaption(b.text);
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
      // sidechain-lite: the bed ducks ~4 dB whenever a voiced line is playing
      if (musicRef.current && voiceRef.current) {
        musicRef.current.duck(!!(voiceRef.current.level && voiceRef.current.level.gateOpen));
      }
      // mirror the spider-voice line queue into the panel
      const v = voiceRef.current;
      if (v) {
        setVoiceUi((prev) => (
          prev.synthState === v.synthState && prev.lines === v.lines
            && prev.currentLine === v.currentLine && prev.nextLine === v.idx
            ? prev
            : { synthState: v.synthState, lines: v.lines, currentLine: v.currentLine, nextLine: v.idx }
        ));
      }
      if (recorderRef.current.recording) {
        const el = recorderRef.current.elapsed;
        setElapsed(el);
        if (scriptRef.current) setBeatIdx(beatRef.current);
      }
    }, 200);
    return () => clearInterval(id);
  }, [booted]);

  /* the actual roll — everything timing-sensitive lives HERE, after the countdown,
     so recStartRef / perfRec.start keep beat timing exactly as before */
  const startRecording = useCallback(() => {
    const rec = recorderRef.current;
    const stage = stageRef.current;
    if (!stage || rec.recording) return;
    const script = scriptRef.current;
    stage.setHud(script ? `COSMIC WEAVER ── TRANSMISSION #${String(script.number).padStart(2, '0')}` : 'COSMIC WEAVER ── LIVE');
    beatRef.current = 0; setBeatIdx(0);
    recStartRef.current = performance.now();
    perfRecRef.current.start({
      name: script ? `transmission-${String(script.number).padStart(2, '0')}` : 'veyl-freestyle',
      world: stage.worldKey,
    });
    // burn the first beat's caption from frame one
    if (script && captionsRef.current && script.beats.length) stage.setCaption(script.beats[0].text);
    // audio for the file: the synthesized spider voice (mic never used); else the
    // music engine's own MediaStreamDestination so a video-only session still ships with score
    const voice = voiceRef.current;
    const music = musicRef.current;
    if (voice && voice.ready) voice.arm(); // rewind to line 1 — first mouth move fires it
    const audioStream = voice && voice.ready ? voice.stream : (music && music.stream) || null;
    const rolled = rec.start(stage, audioStream);
    if (!rolled) {
      // encoder refused at every tier — undo the roll cleanly instead of faking it
      perfRecRef.current.stop();
      stage.setHud('COSMIC WEAVER ── RECORDER OFFLINE');
      stage.setCaption(null);
      return;
    }
    setRecording(true);
  }, []);

  const toggleRec = useCallback(async () => {
    const rec = recorderRef.current;
    const stage = stageRef.current;
    if (!stage) return;
    // Space/REC during the countdown CANCELS it — the HUD never left STANDBY
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
      setCountdown(null);
      return;
    }
    if (!rec.recording) {
      // SCRIPT-FIRST: no take rolls until the script is voiced. REC opens the
      // script sheet instead, so the engine always knows the lines in advance.
      const voice = voiceRef.current;
      if (voice && voice.ready && voice.synthState !== 'ready') {
        setScriptOpen(true);
        return;
      }
      // 3-2-1 before the roll; ticks are synth blips (silent if audio never came up)
      let n = 3;
      setCountdown(n);
      if (musicRef.current) musicRef.current.blip(false);
      countdownRef.current = setInterval(() => {
        n -= 1;
        if (n > 0) {
          setCountdown(n);
          if (musicRef.current) musicRef.current.blip(false);
        } else {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
          setCountdown(null);
          if (musicRef.current) musicRef.current.blip(true);
          startRecording();
        }
      }, 1000);
    } else {
      const take = await rec.stop();
      const perf = perfRecRef.current.stop();
      if (voiceRef.current) voiceRef.current.stopPlayback(); // cut any mid-line audio with the take
      setRecording(false); setElapsed(0);
      stage.setHud('COSMIC WEAVER ── STANDBY');
      stage.setCaption(null);
      if (take) {
        const script = scriptRef.current;
        const name = script ? `transmission-${String(script.number).padStart(2, '0')}-take` : 'veyl-freestyle-take';
        const entry = { ...take, id: `${Date.now()}`, name: `${name}-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}` };
        setTakes((p) => [entry, ...p]);
           // the take as DATA: a `.veyl` rig timeline into the Vault for the Omega Room
        if (perf && perf.frames > 15) {
          perf.name = entry.name;
          vault.put(PERFORMANCES, perf).catch(() => {});
        }
        // auto-download
        const a = document.createElement('a');
        a.href = take.url; a.download = `${entry.name}.${take.ext || 'webm'}`; a.click();
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
  }, [startRecording]);

  const pickScript = useCallback((s) => {
    scriptRef.current = s;
    setActiveScript(s);
    setBeatIdx(0); beatRef.current = 0;
    setWorld(s.world);
    if (stageRef.current) stageRef.current.setHud(`COSMIC WEAVER ── TRANSMISSION #${String(s.number).padStart(2, '0')}`);
  }, [setWorld]);

  const closeScript = useCallback(() => {
    scriptRef.current = null; setActiveScript(null);
    if (stageRef.current) {
      stageRef.current.setHud('COSMIC WEAVER ── STANDBY');
      stageRef.current.setCaption(null);
    }
  }, []);

  /* CC toggle — mirrored into a ref so the frame callback reads it without re-binding */
  const toggleCaptions = useCallback(() => {
    setCaptionsOn((prev) => {
      const next = !prev;
      captionsRef.current = next;
      if (!next && stageRef.current) stageRef.current.setCaption(null);
      return next;
    });
  }, []);

  /* THE SOUND LAYER — panel wiring */
  const onMusicOn = useCallback((on) => {
    setMusicOn(on);
    if (musicRef.current) musicRef.current.setEnabled(on);
  }, []);
  const onBedVol = useCallback((v) => {
    setBedVol(v);
    if (musicRef.current) musicRef.current.setBedVolume(v);
  }, []);
  const onSfxVol = useCallback((v) => {
    setSfxVol(v);
    if (musicRef.current) musicRef.current.setSfxVolume(v);
  }, []);
  const onMusicMonitor = useCallback((on) => {
    setMusicMonitor(on);
    if (musicRef.current) musicRef.current.setMonitor(on);
  }, []);

  /* WORLD EDITOR — named preset shelf, persisted per world */
  const onSaveWorldPreset = useCallback((name) => {
    const k = stageRef.current ? stageRef.current.worldKey : 'nebula-drift';
    setWPresets(savePreset(k, name, wParams));
  }, [wParams]);
  const onApplyWorldPreset = useCallback((p) => applyWorldParams(p.params), [applyWorldParams]);
  const onDeleteWorldPreset = useCallback((name) => {
    const k = stageRef.current ? stageRef.current.worldKey : 'nebula-drift';
    setWPresets(deletePreset(k, name));
  }, []);
  const onResetWorldParams = useCallback(() => applyWorldParams(null), [applyWorldParams]);

  // hotkeys (suspended while the script sheet is open)
  useEffect(() => {
    if (!booted || scriptOpen) return undefined;
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
  }, [booted, scriptOpen, setWorld, setExpr, doGlitch, toggleRec]);

  /* SCRIPT & VOICE sheet — hand over the script, pre-voice every line */
  const openScript = useCallback(() => {
    // prefill from the picked transmission so its beats become the voiced lines
    setScriptText((prev) => {
      if (prev.trim()) return prev;
      const s = scriptRef.current;
      return s && s.beats ? s.beats.map((b) => b.text).join('\n') : prev;
    });
    setScriptOpen(true);
  }, []);
  const doSynth = useCallback(async () => {
    const voice = voiceRef.current;
    if (!voice || !voice.ready || !scriptText.trim()) return;
    await voice.resume();
    setSynthProg({ done: 0, total: 0 });
    const ok = await voice.synthesize(scriptText, (done, total) => setSynthProg({ done, total }));
    setSynthProg(null);
    if (ok) setScriptOpen(false);
  }, [scriptText]);
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
            <p className="text-sm mb-1" style={{ color: 'var(--cw-text-2)' }}>Full-suit AR studio — you become COMPLETELY Spider-Man. The mask visibly lip-syncs as you talk, and your script is pre-voiced as Spidey: mouth a line and it plays instantly. Your mic is never used.</p>
            <p className="mono text-[10px] mb-8" style={{ color: 'var(--cw-muted)' }}>FULL SUIT · SCRIPT-FIRST SPIDER VOICE · NO MIC — 1080×1920 · 60FPS · $0</p>
            <div className="flex flex-col gap-3 items-start">
              <button className="cw-rec" data-testid="boot-live-btn" disabled={booting}
                onClick={() => boot('live')}>{booting ? 'INITIALIZING…' : '● INITIALIZE FULL RIG'}</button>
              <button className="cw-chip" style={{ padding: '10px 18px' }} data-testid="boot-sim-btn" disabled={booting}
                onClick={() => boot('sim')}><span>RUN SIM MODE — NO CAMERA</span></button>
            </div>
            <p className="mono text-[9px] mt-8" style={{ color: 'var(--cw-muted)' }}>ALLOW CAMERA ONLY — THE MIC IS NEVER REQUESTED · WEAR HEADPHONES IF MONITORING</p>
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
        <Link to="/omega" className="cw-chip mono text-[10px]" style={{ padding: '8px 14px', textDecoration: 'none' }} data-testid="omega-link">
          <span>Ω OMEGA ROOM</span>
        </Link>
        {recording && <span className="mono text-sm" style={{ color: 'var(--cw-red)' }} data-testid="rec-timer">● {fmtClock(elapsed)}</span>}
        <button className={`cw-rec ${recording ? 'live' : ''}`} disabled={!booted} data-testid="record-btn" onClick={toggleRec}>
          {recording ? '■ STOP & SAVE' : micOk && voiceUi.synthState !== 'ready' ? '● SCRIPT → REC' : '● REC'}
        </button>
      </header>

      {/* main grid */}
      <main className="grid grid-cols-1 lg:grid-cols-12 gap-3 p-3">
        {/* left rail */}
        <div className="lg:col-span-3 space-y-3 order-2 lg:order-1">
          <VoicePanel synthState={voiceUi.synthState} lines={voiceUi.lines} currentLine={voiceUi.currentLine}
            nextLine={voiceUi.nextLine} monitor={monitor} onMonitor={onMonitor} level={level}
            voiceOk={micOk} onEditScript={openScript} recording={recording} />
          <MusicPanel on={musicOn} onOn={onMusicOn} bedVol={bedVol} onBedVol={onBedVol}
            sfxVol={sfxVol} onSfxVol={onSfxVol} monitor={musicMonitor} onMonitor={onMusicMonitor} ready={musicReady} />
          <ScenePanel world={world} onWorld={setWorld} />
          <WorldEditorPanel world={world} params={wParams} onParam={onWorldParam}
            presets={wPresets} onSavePreset={onSaveWorldPreset} onApplyPreset={onApplyWorldPreset}
            onDeletePreset={onDeleteWorldPreset} onReset={onResetWorldParams} isDefault={isDefaultParams(wParams)} />
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
            {activeScript && (
              <button className="mono absolute top-2 left-2 text-[9px] bg-black/60 border px-2 py-1 cursor-pointer z-10"
                style={{ borderColor: captionsOn ? 'var(--cw-red)' : 'var(--cw-border)', color: captionsOn ? 'var(--cw-text-2)' : 'var(--cw-muted)' }}
                data-testid="captions-toggle" onClick={toggleCaptions}>CC {captionsOn ? 'ON' : 'OFF'}</button>
            )}
            <Prompter script={activeScript} beatIdx={beatIdx} recording={recording} elapsed={elapsed} onClose={closeScript} />
            {/* 3-2-1 countdown — full-viewport, big mono digit, red ring; REC/Space cancels */}
            {countdown !== null && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4"
                style={{ background: 'rgba(0,0,0,0.55)' }} data-testid="countdown-overlay"
                role="status" aria-live="assertive">
                <div className="flex items-center justify-center rounded-full"
                  style={{ width: 140, height: 140, border: '3px solid var(--cw-red)', boxShadow: '0 0 40px rgba(255,26,46,0.4)' }}>
                  <span className="mono font-bold" style={{ fontSize: 72, color: 'var(--cw-red)' }} data-testid="countdown-digit">{countdown}</span>
                </div>
                <span className="mono text-[10px]" style={{ color: 'var(--cw-text-2)', letterSpacing: '0.3em' }}>
                  ROLLING IN {countdown}… · SPACE / REC CANCELS
                </span>
              </div>
            )}
          </div>
        </div>

        {/* right rail */}
        <div className="lg:col-span-4 space-y-3 order-3 flex flex-col">
          <StatusPanel tracking={tracking} micOk={micOk} fps={fps} mode={booted === 'sim' ? 'sim' : rigRef.current.tracking.mode} />
          <ScriptLog active={activeScript} onPick={pickScript} progress={progress} recording={recording} beatIdx={beatIdx} />
          <TakesPanel takes={takes} onDelete={(id) => {
            setTakes((p) => p.filter((t) => t.id !== id));
            axios.delete(`${API}/takes/${id}`).catch(() => {});
          }} />
        </div>
      </main>

      {/* SCRIPT & VOICE sheet — the take cannot roll until this is done.
          Paste the script, synthesize it, THEN record: the engine knows every
          line in advance, so your lips fire each pre-voiced line perfectly. */}
      {scriptOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.72)' }} data-testid="script-sheet"
          role="dialog" aria-modal="true" aria-label="Script and voice">
          <div className="cw-panel w-full max-w-lg" style={{ background: 'var(--cw-bg, #0a0a0f)' }}>
            <h2>◪ Script &amp; Spider Voice</h2>
            <p className="mono text-[9px] mb-2" style={{ color: 'var(--cw-muted)' }}>
              STEP 1 · HAND OVER THE SCRIPT — EVERY LINE IS PRE-VOICED AS SPIDER-MAN (FREE TTS, NO MIC).<br />
              STEP 2 · RECORD — MOUTH EACH LINE AND THE VOICE FIRES THE INSTANT YOUR LIPS MOVE.
            </p>
            <textarea
              className="w-full mono text-[11px] p-2 mb-2"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--cw-border)', color: 'var(--cw-text-2)', minHeight: 160, resize: 'vertical' }}
              placeholder={'One line per beat, e.g.\nHey, your friendly neighborhood Spider-Man here.\nWith great power comes great responsibility.'}
              value={scriptText} data-testid="script-textarea"
              onChange={(e) => setScriptText(e.target.value)} disabled={!!synthProg} />
            {synthProg && (
              <div className="mono text-[9px] mb-2" style={{ color: 'var(--cw-amber)' }} data-testid="synth-progress">
                SYNTHESIZING SPIDER VOICE… {synthProg.total ? `${synthProg.done}/${synthProg.total}` : ''}
              </div>
            )}
            {voiceUi.synthState === 'error' && !synthProg && (
              <div className="mono text-[9px] mb-2" style={{ color: 'var(--cw-red)' }}>
                TTS UNREACHABLE — CHECK YOUR CONNECTION AND TRY AGAIN
              </div>
            )}
            <div className="flex items-center gap-2">
              <button className="cw-rec" data-testid="script-synth-btn"
                disabled={!scriptText.trim() || !!synthProg || !micOk} onClick={doSynth}>
                {synthProg ? 'VOICING…' : '◪ VOICE THE SCRIPT'}
              </button>
              <button className="cw-chip" style={{ padding: '10px 16px' }} data-testid="script-close-btn"
                disabled={!!synthProg} onClick={() => setScriptOpen(false)}>
                <span>CLOSE</span>
              </button>
            </div>
            {!micOk && (
              <p className="mono text-[9px] mt-2" style={{ color: 'var(--cw-red)' }}>AUDIO ENGINE OFFLINE — RELOAD AND REBOOT THE RIG</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


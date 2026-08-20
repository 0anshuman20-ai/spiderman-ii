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
import { ScriptLog, Prompter, UploadKit } from '../components/studio/Teleprompter';
import { TakesPanel } from '../components/studio/TakesPanel';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/* seconds the FINAL caption stays on screen past its own audio, so the closing
   words are readable in the last frames. The auto-cut waits for the caption to
   actually clear (stage.captionRemaining()), so raising this extends the take
   instead of getting truncated by the cut. */
const CLOSER_HOLD = 1.6;

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
  const captionsRef = useRef(true);    // mirrored into the frame callback — ON: captions carry retention
  const capLineRef = useRef(-1);       // last line the karaoke caption was fired for
  const paramsTimerRef = useRef(null); // debounce for world-editor rebuilds
  /* THE AUTO-CUT — when the last voiced line lands, the outro sting fires and
     the take cuts itself a beat later: zero dead air after the final word. */
  const toggleRecRef = useRef(null);   // latest toggleRec, callable from the poll
  const doneTRef = useRef(0);          // seconds since the script finished
  const outroFiredRef = useRef(false); // the closing sting fires exactly once

  const [booted, setBooted] = useState(null); // null | 'live' | 'sim'
  const [booting, setBooting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [cutting, setCutting] = useState(false); // auto jump-cut is holding the file
  const [world, setWorldState] = useState('nebula-drift');
  const [expr, setExprState] = useState('calm');
  const [monitor, setMonitor] = useState(false);
  const [level, setLevel] = useState(0);
  const [micOk, setMicOk] = useState(false); // = spider-voice engine online (mic is never used)
  // SPIDER VOICE — script-first: the script is synthesized BEFORE any take
  const [voiceUi, setVoiceUi] = useState({ synthState: 'empty', lines: [], currentLine: -1, nextLine: 0, micLive: false });
  const [scriptOpen, setScriptOpen] = useState(false);
  const [scriptText, setScriptText] = useState('');
  const [synthProg, setSynthProg] = useState(null); // null | { done, total }
  const [uploadMsg, setUploadMsg] = useState(null); // null | { ok, message } — real-voice upload status
  const uploadInputRef = useRef(null);
  const personalRecorderRef = useRef(null);
  const personalStreamRef = useRef(null);
  const personalTimerRef = useRef(null);
  const personalChunksRef = useRef([]);
  const [personalVoice, setPersonalVoice] = useState({ state: 'idle', seconds: 0, url: null, blob: null, level: 0, error: '' });
  const [tracking, setTracking] = useState({ face: false, pose: false, hands: false });
  const [fps, setFps] = useState(0);
  const [takes, setTakes] = useState([]);
  const [activeScript, setActiveScript] = useState(null);
  const [beatIdx, setBeatIdx] = useState(0);
  const [progress, setProgress] = useState({});
  const [pipOn, setPipOn] = useState(true);
  const [glitchUi, setGlitchUi] = useState(false);
  const [countdown, setCountdown] = useState(null); // null | 3 | 2 | 1
  const [captionsOn, setCaptionsOn] = useState(true); // default ON: word-by-word captions are the retention layer
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
    if (personalTimerRef.current) clearInterval(personalTimerRef.current);
    if (personalStreamRef.current) personalStreamRef.current.getTracks().forEach((track) => track.stop());
    if (personalRecorderRef.current && personalRecorderRef.current.state === 'recording') {
      try { personalRecorderRef.current.stop(); } catch (_) {}
    }
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
      const rec = recorderRef.current;
      /* the lip watcher: your jaw is the trigger — the engine already knows the
         script, so the pre-voiced line fires the instant your mouth opens.
         (Auto jump-cut pause/resume was removed: MediaRecorder.pause()/resume()
         on a canvas+WebAudio stream corrupts video timestamps in Chromium —
         the exported file froze mid-take with drifting audio. The recorder now
         rolls continuously, so the file stays perfectly in sync end to end.) */
      voice.update(dt, rig.jaw, rec.recording);
      /* mirror the voice state onto the rig so the mask compositor can make
         the AUDIO authoritative over the mouth: during a script take the
         mask's lips follow the played line and shut when it ends — your real
         lips only trigger lines, they never flap the mask after the audio. */
      /* audio-authoritative whenever a scripted line exists AND we're either
         rolling or a line is audibly playing (preview too) — so the mask's
         mouth always follows the sound and always seals when a line ends. */
      rig.voiceActive = voice.ready && voice.canRoll() && voice.lines.length > 0
        && (rec.recording || voice.playing);
      rig.voicePlaying = voice.playing;
      rig.voiceBuffered = !!voice._src; // false in browser-speech fallback
      if (voice.ready && rig.tracking.mode !== 'sim') {
        const voiceLevel = Math.min(1, Math.max(voice.level.rms * 4, voice.outputLevel()));
        /* Audio already has a short analyser window and the suit owns the final
           jaw easing. A third 0.35 smoothing pass here delayed every consonant
           by several frames. Follow attacks immediately; retain only a brief
           release so the world/meter remains stable between waveform samples. */
        const k = voiceLevel >= rig.level ? 1 : 1 - Math.exp(-dt * 28);
        rig.level += (voiceLevel - rig.level) * k;
      }
      // auto-perform teleprompter cues while recording — on RECORDED time, so
      // beat cues stay glued to the exported file even across jump-cuts
      const script = scriptRef.current;
      if (script && rec.recording) {
        const el = rec.elapsed;
        let idx = 0;
        for (let i = 0; i < script.beats.length; i++) if (el >= script.beats[i].t) idx = i;
        if (idx !== beatRef.current) {
          beatRef.current = idx;
          const b = script.beats[idx];
          rig.expression = EMOTE_TO_EXPR[b.emote] || 'calm';
          (FX_MAP[b.fx] || FX_MAP.none)(stage, voice, musicRef.current);
        }
      }
      /* WORD-BY-WORD CAPTIONS — driven by the line actually PLAYING, so the
         karaoke pacing rides the real audio (TTS or uploaded voice), not the
         planned beat sheet. Fires once per line, animates in the stage loop. */
      if (rec.recording && captionsRef.current && voice.ready
          && voice.currentLine >= 0 && voice.currentLine !== capLineRef.current) {
        capLineRef.current = voice.currentLine;
        const line = voice.lines[voice.currentLine];
        /* FINAL-LINE HOLD: the last caption used to die the instant its audio
           did — the karaoke reached the closing words exactly as the cut
           landed, so they were never readable. The words still pace across
           the real audio duration; the finished line then HOLDS through the
           outro so the closer stays on screen into the final frame. */
        const isLast = voice.currentLine === voice.lines.length - 1;
        if (line) {
          /* SYNC, THREE WAYS AT ONCE:
             1. clock samples the recorder's AudioContext timeline every frame
                (startAt is only the browser-speech fallback);
             2. delay hides the caption through the buffer's lead-in silence,
                so no words show before the first one is spoken;
             3. speechDur paces the highlight across the REAL first->last
                voiced sample span — pacing across the raw buffer (padded
                silence included) ran slower than the voice. */
          const timing = voice.lineTiming(voice.currentLine);
          const myLine = voice.currentLine;
          /* CLOSER_HOLD keeps the last caption readable past its audio; the
             auto-cut below waits on stage.captionRemaining(), so this hold and
             the outro window can no longer be tuned out of sync with each
             other — whichever finishes last decides the cut. */
          stage.playCaption(line.text, timing.speechDur, isLast ? CLOSER_HOLD : 0, {
            startAt: voice.lineStartedAt,
            delay: timing.leadIn,
            /* the karaoke re-reads the real audio playhead every frame; guarded
               by line identity so a stale closure can't pace the wrong line */
            clock: () => (voice.currentLine === myLine ? voice.lineElapsed() : null),
          });
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
            && prev.micLive === !!v.micMode
            ? prev
            : { synthState: v.synthState, lines: v.lines, currentLine: v.currentLine, nextLine: v.idx, micLive: !!v.micMode }
        ));
      }
      if (recorderRef.current.recording) {
        const el = recorderRef.current.elapsed;
        setElapsed(el);
        setCutting(recorderRef.current.paused);
        if (scriptRef.current) setBeatIdx(beatRef.current);
        /* THE AUTO-CUT — the last voiced line has landed: fire the outro
           cadence immediately (so it lives INSIDE the file), then cut the
           take a beat later. Timed on WALL CLOCK from the audio's real end
           (the old tick counter assumed this interval ran exactly on time;
           under recording load it's throttled, so ticks arrive late but each
           still added a full 0.2s — the counter outran reality and cut the
           file before the final words had physically elapsed). The window
           also pads for the audio still draining through the output chain
           (context latency + compressor/reverb tail), so the mix finishes
           INSIDE the file, every time. */
        if (v && v.ready && v.canRoll() && v.lines.length > 0 && v.done) {
          if (!outroFiredRef.current) {
            outroFiredRef.current = true;
            if (musicRef.current) musicRef.current.outro();
          }
          /* 1.0s (was 2.6): secondsSinceDone() now counts from the REAL end of
             speech (the padded buffer tail is subtracted at the source), so the
             window no longer needs to over-compensate — and the old 2.6s left
             seconds of voiceless video hanging at the end of every take. 1.0s
             plus the physical drain (context latency + compressor release) is
             exactly enough for the outro sting and the closer caption to land
             inside the file with no dead air after the final word. */
          const outroWindow = 1.0 + v.tailSeconds();
          /* THE CUT WAITS FOR WHICHEVER FINISHES LAST — the audio drain or the
             closing caption. Previously these were two independently hand-tuned
             numbers: the window was 1.0s + drain while the final caption held
             2.2s, so the cut landed while the closer still had ~1.2s to run and
             chopped the last words off the file. Reading the caption's real
             remaining time makes truncation structurally impossible, and adds no
             dead air beyond what the caption needs. */
          const st = stageRef.current;
          const capLeft = st && st.captionRemaining ? st.captionRemaining() : 0;
          const closerDone = capLeft <= 0;
          if (doneTRef.current !== -999 && v.secondsSinceDone() >= outroWindow && closerDone) {
            doneTRef.current = -999; // one-shot guard
            if (toggleRecRef.current) toggleRecRef.current();
          }
        } else if (doneTRef.current > 0) {
          doneTRef.current = 0;
        }
      } else {
        setCutting(false);
      }
    }, 200);
    return () => clearInterval(id);
  }, [booted]);

  /* the actual roll — everything timing-sensitive lives HERE, after the countdown,
     so recStartRef / perfRec.start keep beat timing exactly as before */
  const startRecording = useCallback(async () => {
    const rec = recorderRef.current;
    const stage = stageRef.current;
    if (!stage || rec.recording) return;
    const script = scriptRef.current;
    stage.setHud(script ? `COSMIC WEAVER ── TRANSMISSION #${String(script.number).padStart(2, '0')}` : 'COSMIC WEAVER ── LIVE');
    beatRef.current = 0; setBeatIdx(0);
    recStartRef.current = performance.now();
    perfRecRef.current.start({
      name: script ? `transmission-${String(script.number).padStart(2, '0')}` : 'spacespidey-freestyle',
      world: stage.worldKey,
    });
    /* FIRST-FRAME HOOK — the opening frame IS the thumbnail. Never a fade-in:
       hit frame one with a clean punch-in and the hook text already burned on
       screen, so the 0.5s a swiper gives you is spent mid-action. (The old
       glitch burst on frame one read as a broken encode, not a style choice —
       the take now opens crisp; scripted beats can still call the glitch FX.) */
    capLineRef.current = -1;
    stage.punch();
    // audio for the file: the synthesized spider voice (mic never used); else the
    // music engine's own MediaStreamDestination so a video-only session still ships with score
    const voice = voiceRef.current;
    /* the frame-one hook caption burned script words onto the screen BEFORE the
       performer spoke them — "it displays some words before I'm speaking". On a
       voiced take the first words now appear only when line 1's audio fires;
       the hook still opens freestyle (no scripted lines) takes. */
    const voicedTake = !!(voice && voice.ready && voice.canRoll() && voice.lines.length > 0);
    const hookText = script ? (script.hook || (script.beats[0] && script.beats[0].text)) : null;
    if (hookText && captionsRef.current && !voicedTake) stage.playCaption(hookText, 2.2);
    const music = musicRef.current;
    if (voice && voice.ready) voice.arm(); // rewind to line 1 — first mouth move fires it
    /* AUDIO INTO THE FILE — always hand the recorder the voice engine's
       MediaStreamDestination when the engine is up: the music engine mixes its
       score into that same destination, so this one stream carries BOTH the
       synthesized voice and the score. (The old logic dropped to music.stream
       in fallback mode — but music borrows the voice context and owns no
       stream of its own there, so the take shipped with NO audio track at
       all: a silent download.) A suspended AudioContext also records pure
       silence, so both contexts are resumed — and AWAITED — before the roll:
       starting the MediaRecorder while the context is still suspended makes
       the audio track deliver its first samples late, and the muxer ships
       that as a 1–2s audio offset baked into the file. */
    await Promise.allSettled([
      voice && voice.ready ? voice.resume() : Promise.resolve(),
      music && music.resume ? music.resume() : Promise.resolve(),
    ]);
    const audioStream = (voice && voice.ready && voice.stream) || (music && music.stream) || null;
    const rolled = rec.start(stage, audioStream);
    if (!rolled) {
      // encoder refused at every tier — undo the roll cleanly instead of faking it
      perfRecRef.current.stop();
      stage.setHud('COSMIC WEAVER ── RECORDER OFFLINE');
      stage.setCaption(null);
      return;
    }
    /* THE HERO SCORE — frame one opens on an impact and the driving groove is
       already running, so the take never has a cold, silent opening. */
    if (music && music.ready) {
      music.startScore();
      music.impact();
    }
    doneTRef.current = 0;
    outroFiredRef.current = false;
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
      if (voice && voice.ready && !voice.canRoll()) {
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
      if (musicRef.current) musicRef.current.stopScore();    // groove out, ambient bed back
      setRecording(false); setElapsed(0);
      stage.setHud('COSMIC WEAVER ── STANDBY');
      stage.setCaption(null);
      if (take) {
        const script = scriptRef.current;
        const name = script ? `transmission-${String(script.number).padStart(2, '0')}-take` : 'spacespidey-freestyle-take';
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

  // the telemetry poll cuts the take through this ref — always the latest closure
  useEffect(() => { toggleRecRef.current = toggleRec; }, [toggleRec]);

  const pickScript = useCallback((s) => {
    scriptRef.current = s;
    setActiveScript(s);
    setBeatIdx(0); beatRef.current = 0;
    setWorld(s.world);
    // the picked script IS the spoken script: its beats (and loop line) become
    // the voiced lines. THE VOICE IS ALWAYS THE YOUNG HERO — preset moods used
    // to drag the delivery down into a slow, low "mystery" read, which is why
    // the voice stopped sounding like Spidey after picking a transmission.
    const lines = (s.beats || []).map((b) => b.text);
    if (s.loopLine) lines.push(s.loopLine);
    setScriptText(lines.join('\n'));
    if (voiceRef.current) {
      voiceRef.current.setMood('hero');
      /* BEAT-AWARE DELIVERY — one emote per pasted row: the voice engine uses
         these for emote-shaped inter-line gaps and per-line prosody moods
         (same locked voice), so the read breathes like the beat sheet. */
      const emotes = (s.beats || []).map((b) => b.emote || 'neutral');
      if (s.loopLine) emotes.push('neutral');
      voiceRef.current.setLineEmotes(emotes);
    }
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
      if (!s || !s.beats) return prev;
      const lines = s.beats.map((b) => b.text);
      if (s.loopLine) lines.push(s.loopLine);
      /* the prefill IS the transmission's beat sheet — carry its emotes so
         beat-aware pacing/prosody applies even when the sheet was opened
         before ever touching the transmission picker */
      if (voiceRef.current) {
        const emotes = s.beats.map((b) => b.emote || 'neutral');
        if (s.loopLine) emotes.push('neutral');
        voiceRef.current.setLineEmotes(emotes);
      }
      return lines.join('\n');
    });
    setScriptOpen(true);
  }, []);
  const stopPersonalVoice = useCallback(() => {
    const recorder = personalRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      /* FLUSH THE TAIL — with 250ms timeslices the final chunk (your last
         words!) rides only on the implicit stop-flush, which Chromium drops
         under load. requestData() forces the encoder to emit what it holds,
         and a settle beat lets that chunk land BEFORE stop(), so the end of
         your read is guaranteed to be inside the file. */
      try { recorder.requestData(); } catch (_) {}
      setTimeout(() => { try { if (recorder.state === 'recording') recorder.stop(); } catch (_) {} }, 300);
    }
  }, []);

  const removePersonalVoice = useCallback(() => {
    stopPersonalVoice();
    setPersonalVoice((prev) => {
      if (prev.url) URL.revokeObjectURL(prev.url);
      return { state: 'idle', seconds: 0, url: null, blob: null, level: 0, error: '' };
    });
  }, [stopPersonalVoice]);

  const startPersonalVoice = useCallback(async () => {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      setPersonalVoice((prev) => ({ ...prev, error: 'This browser cannot record audio. Try Chrome or Edge.' }));
      return;
    }
    removePersonalVoice();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
          voiceIsolation: { ideal: true },
          channelCount: { ideal: 1 },
          sampleRate: { ideal: 48000 },
          sampleSize: { ideal: 24 },
          latency: { ideal: 0.01 },
        },
      });
      personalStreamRef.current = stream;
      const choices = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
      const mimeType = choices.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 192000 } : undefined);
      personalRecorderRef.current = recorder;
      personalChunksRef.current = [];
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const startedAt = performance.now();
      recorder.ondataavailable = (event) => { if (event.data.size) personalChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        if (personalTimerRef.current) clearInterval(personalTimerRef.current);
        const blob = new Blob(personalChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        stream.getTracks().forEach((track) => track.stop());
        personalStreamRef.current = null;
        audioCtx.close().catch(() => {});
        setPersonalVoice((prev) => ({ ...prev, state: 'ready', blob, url, level: 0, error: '' }));
      };
      recorder.start(250);
      setPersonalVoice({ state: 'recording', seconds: 0, url: null, blob: null, level: 0, error: '' });
      personalTimerRef.current = setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) { const value = (sample - 128) / 128; sum += value * value; }
        const liveLevel = Math.min(1, Math.sqrt(sum / samples.length) * 4);
        setPersonalVoice((prev) => ({ ...prev, seconds: (performance.now() - startedAt) / 1000, level: liveLevel }));
      }, 100);
    } catch (err) {
      const message = err && err.name === 'NotAllowedError'
        ? 'Mic permission was blocked. Allow it in your browser, then try again.'
        : `Could not start the mic: ${err.message || 'unknown error'}`;
      setPersonalVoice((prev) => ({ ...prev, state: 'idle', error: message }));
    }
  }, [removePersonalVoice]);

  const usePersonalVoice = useCallback(async () => {
    const voice = voiceRef.current;
    if (!personalVoice.blob || !voice || !voice.ready) return;
    setUploadMsg({ ok: true, message: 'enhancing and matching your voice to the script…' });
    try {
      await voice.resume();
      const res = await voice.loadUpload(await personalVoice.blob.arrayBuffer(), scriptText);
      setUploadMsg(res);
      if (res.ok) setTimeout(() => { setUploadMsg(null); setScriptOpen(false); }, 1200);
    } catch (err) {
      setUploadMsg({ ok: false, message: `voice processing failed: ${err.message}` });
    }
  }, [personalVoice.blob, scriptText]);

  /* UPLOADED REAL VOICE — record the whole script in one take with a clear pause
     between lines; the engine slices it and maps each slice to its line. */
  const onUploadVoice = useCallback(async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    const voice = voiceRef.current;
    if (!f || !voice || !voice.ready) return;
    setUploadMsg({ ok: true, message: 'decoding & slicing the performance…' });
    try {
      await voice.resume();
      const res = await voice.loadUpload(await f.arrayBuffer(), scriptText);
      setUploadMsg(res);
      if (res.ok) setTimeout(() => { setUploadMsg(null); setScriptOpen(false); }, 1200);
    } catch (err) {
      setUploadMsg({ ok: false, message: `upload failed: ${err.message}` });
    }
  }, [scriptText]);

  /* LIVE MIC — your REAL voice, live during the camera take, running through
     the full real-time enhancement chain (OS noise suppression + repair EQ +
     broadcast compression) straight into the file. Lines are fired by your
     VOICE, so the caption can only ever follow what you are actually saying. */
  const goLiveMic = useCallback(async () => {
    const voice = voiceRef.current;
    if (!voice || !voice.ready || !scriptText.trim()) return;
    setUploadMsg({ ok: true, message: 'opening the mic + live enhancer…' });
    try {
      await voice.resume();
      const res = await voice.enableLiveMic(scriptText);
      setUploadMsg(res);
      if (res.ok) setTimeout(() => { setUploadMsg(null); setScriptOpen(false); }, 1200);
    } catch (err) {
      setUploadMsg({ ok: false, message: `live mic failed: ${err.message}` });
    }
  }, [scriptText]);

  const stopLiveMic = useCallback(() => {
    const voice = voiceRef.current;
    if (voice) voice.disableLiveMic();
    setUploadMsg(null);
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
  // a take may roll once the script is voiced — decoded TTS, the browser voice,
  // or the LIVE MIC (your real voice, enhanced in real time during the take)
  const voiceRollable = voiceUi.synthState === 'ready' || voiceUi.synthState === 'fallback'
    || (voiceUi.synthState === 'live' && voiceUi.micLive);

  return (
    <div className={`min-h-screen ${glitchUi ? 'cw-glitching' : ''}`} data-testid="studio-root">
      {/* boot overlay */}
      {!booted && (
        <div className="cw-boot" data-testid="boot-overlay">
          <div className="cw-boot-inner">
            <div className="mono text-[10px] mb-3" style={{ color: 'var(--cw-red)', letterSpacing: '0.3em' }}>SIGNAL ORIGIN: UNKNOWN SECTOR</div>
            <h1 className="mono text-4xl sm:text-5xl font-bold mb-2 tracking-tight">COSMIC<br />WEAVER</h1>
            <p className="text-sm mb-1" style={{ color: 'var(--cw-text-2)' }}>Full-suit AR studio with two voice choices: use the Spider Voice, or record your own voice with earbud-friendly enhancement.</p>
            <p className="mono text-[10px] mb-8" style={{ color: 'var(--cw-muted)' }}>FULL SUIT · SPIDER VOICE OR YOUR VOICE · 1080×1920 · 60FPS · $0</p>
            <div className="flex flex-col gap-3 items-start">
              <button className="cw-rec" data-testid="boot-live-btn" disabled={booting}
                onClick={() => boot('live')}>{booting ? 'INITIALIZING…' : '● INITIALIZE FULL RIG'}</button>
              <button className="cw-chip" style={{ padding: '10px 18px' }} data-testid="boot-sim-btn" disabled={booting}
                onClick={() => boot('sim')}><span>RUN SIM MODE — NO CAMERA</span></button>
            </div>
            <p className="mono text-[9px] mt-8" style={{ color: 'var(--cw-muted)' }}>CAMERA IS ASKED AT START · MIC IS ASKED ONLY IF YOU CHOOSE RECORD MY OWN VOICE</p>
          </div>
        </div>
      )}

      {/* header */}
      <header className="flex items-center gap-4 px-4 py-2.5" style={{ borderBottom: '1px solid var(--cw-border)' }}>
        <span className="mono font-bold text-sm tracking-widest" data-testid="header-brand">COSMIC WEAVER <span style={{ color: 'var(--cw-red)' }}>// SpaceSpidey STUDIO</span></span>
        <span className="mono text-[9px] hidden md:inline" style={{ color: 'var(--cw-muted)' }}>
          {booted === 'sim' ? 'SIM PERFORMER' : booted === 'live' ? 'LIVE TRACKING' : 'OFFLINE'}
        </span>
        <div className="flex-1" />
        <Link to="/omega" className="cw-chip mono text-[10px]" style={{ padding: '8px 14px', textDecoration: 'none' }} data-testid="omega-link">
          <span>Ω OMEGA ROOM</span>
        </Link>
        {recording && cutting && (
          <span className="mono text-[9px] px-2 py-1" data-testid="autocut-chip"
            style={{ color: 'var(--cw-amber)', border: '1px solid var(--cw-border)', letterSpacing: '0.2em' }}>
            ✂ CUT — SPEAK TO ROLL
          </span>
        )}
        {recording && <span className="mono text-sm" style={{ color: cutting ? 'var(--cw-muted)' : 'var(--cw-red)' }} data-testid="rec-timer">● {fmtClock(elapsed)}</span>}
        <button className={`cw-rec ${recording ? 'live' : ''}`} disabled={!booted} data-testid="record-btn" onClick={toggleRec}>
          {recording ? '■ STOP & SAVE' : micOk && !voiceRollable ? '● SCRIPT → REC' : '● REC'}
        </button>
      </header>

      {/* main grid */}
      <main className="grid grid-cols-1 lg:grid-cols-12 gap-3 p-3">
        {/* left rail */}
        <div className="lg:col-span-3 space-y-3 order-2 lg:order-1">
          <VoicePanel synthState={voiceUi.synthState} lines={voiceUi.lines} currentLine={voiceUi.currentLine}
            nextLine={voiceUi.nextLine} monitor={monitor} onMonitor={onMonitor} level={level}
            voiceOk={micOk} onEditScript={openScript} recording={recording} micLive={voiceUi.micLive} />
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
          <UploadKit script={activeScript} />
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
              onChange={(e) => {
                setScriptText(e.target.value);
                /* HAND-EDITED SCRIPT: the beat-sheet emotes are indexed by ROW,
                   so any manual edit can shift the rows and land the wrong
                   pacing/prosody on the wrong line. Clear them — an edited
                   script reads with clean neutral pacing instead of a
                   misaligned emotional map. Re-picking a transmission
                   restores its emotes. */
                if (voiceRef.current) voiceRef.current.setLineEmotes(null);
                /* LIVE MIC stays armed through an edit: re-bind the fresh lines
                   immediately so the caption queue can never go stale against
                   what you are about to say on camera */
                if (voiceRef.current && voiceRef.current.micMode) voiceRef.current.enableLiveMic(e.target.value);
              }} disabled={!!synthProg || personalVoice.state === 'recording'} />
            <section className="mb-3 border p-3" style={{ borderColor: 'var(--cw-border)', background: 'rgba(255,255,255,0.025)' }} aria-labelledby="own-voice-title">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 id="own-voice-title" className="mono text-[10px]" style={{ color: 'var(--cw-cyan)' }}>RECORD MY OWN VOICE</h3>
                {personalVoice.state === 'recording' && <span className="mono text-[10px]" style={{ color: 'var(--cw-red)' }}>● {fmtClock(personalVoice.seconds)}</span>}
              </div>
              <p className="mono text-[9px] mb-2" style={{ color: 'var(--cw-muted)' }}>
                QUIET ROOM · EARBUD MIC 5–10 CM FROM YOUR MOUTH · AIM IT SLIGHTLY TO THE SIDE · PAUSE BETWEEN LINES
              </p>
              {personalVoice.state === 'recording' && (
                <div className="cw-meter mb-2" aria-label="Microphone level"><div style={{ width: `${personalVoice.level * 100}%` }} /></div>
              )}
              {personalVoice.url && <audio className="w-full mb-2" src={personalVoice.url} controls preload="metadata" data-testid="personal-voice-preview" />}
              <div className="flex flex-wrap gap-2">
                {personalVoice.state !== 'recording' ? (
                  <button className="cw-chip" style={{ padding: '9px 14px' }} disabled={!scriptText.trim() || !!synthProg}
                    onClick={startPersonalVoice} data-testid="personal-voice-record"><span>{personalVoice.blob ? '● RE-RECORD' : '● START RECORDING'}</span></button>
                ) : (
                  <button className="cw-rec live" onClick={stopPersonalVoice} data-testid="personal-voice-stop">■ STOP</button>
                )}
                {personalVoice.blob && (
                  <button className="cw-rec" disabled={!!synthProg} onClick={usePersonalVoice} data-testid="personal-voice-use">USE ENHANCED VOICE</button>
                )}
                {personalVoice.blob && (
                  <button className="cw-chip" style={{ padding: '9px 14px' }} onClick={removePersonalVoice} data-testid="personal-voice-remove"><span>REMOVE</span></button>
                )}
              </div>
              <p className="mono text-[9px] mt-2" style={{ color: 'var(--cw-text-2)' }}>
                VOICE ENHANCEMENT REDUCES NOISE, ADDS CLARITY, EVENS VOLUME, AND STOPS CLIPPING. IT IMPROVES EARBUD AUDIO, BUT CANNOT TURN A NOISY ROOM INTO A STUDIO.
              </p>
              {personalVoice.error && <p className="mono text-[9px] mt-2" role="alert" style={{ color: 'var(--cw-red)' }}>{personalVoice.error}</p>}
            </section>
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
            <div className="flex flex-wrap items-center gap-2">
              <button className={`cw-rec ${voiceUi.micLive ? 'live' : ''}`} data-testid="live-mic-btn"
                disabled={!scriptText.trim() || !!synthProg || !micOk || personalVoice.state === 'recording'}
                onClick={voiceUi.micLive ? stopLiveMic : goLiveMic}>
                {voiceUi.micLive ? '● LIVE MIC ON — TURN OFF' : '● SPEAK LIVE ON CAMERA'}
              </button>
              <button className="cw-rec" data-testid="script-synth-btn"
                disabled={!scriptText.trim() || !!synthProg || !micOk} onClick={doSynth}>
                {synthProg ? 'VOICING…' : '◪ VOICE THE SCRIPT'}
              </button>
              <button className="cw-chip" style={{ padding: '10px 16px' }} data-testid="voice-upload-btn"
                disabled={!scriptText.trim() || !!synthProg || !micOk}
                onClick={() => uploadInputRef.current && uploadInputRef.current.click()}>
                <span>▲ UPLOAD REAL VOICE</span>
              </button>
              <input ref={uploadInputRef} type="file" accept="audio/*" className="hidden"
                data-testid="voice-upload-input" onChange={onUploadVoice} />
              <button className="cw-chip" style={{ padding: '10px 16px' }} data-testid="script-close-btn"
                disabled={!!synthProg} onClick={() => setScriptOpen(false)}>
                <span>CLOSE</span>
              </button>
            </div>
            <p className="mono text-[9px] mt-2" style={{ color: voiceUi.micLive ? 'var(--cw-green)' : 'var(--cw-muted)' }}>
              {voiceUi.micLive
                ? 'LIVE MIC ARMED — CLOSE THIS SHEET, HIT REC, AND SPEAK EACH LINE ON CAMERA. YOUR VOICE IS ENHANCED IN REAL TIME AND THE CAPTION FOLLOWS THE WORDS YOU ACTUALLY SAY.'
                : 'SPEAK LIVE = YOUR REAL VOICE, RECORDED WITH THE CAMERA AND ENHANCED IN REAL TIME (NOISE KILL, EQ REPAIR, BROADCAST COMPRESSION). CAPTIONS ARE DRIVEN BY YOUR VOICE, NOT LIP GUESSES — PAUSE BRIEFLY BETWEEN LINES.'}
            </p>
            {uploadMsg && (
              <div className="mono text-[9px] mt-2" data-testid="upload-status"
                style={{ color: uploadMsg.ok ? 'var(--cw-amber)' : 'var(--cw-red)' }}>
                {String(uploadMsg.message).toUpperCase()}
              </div>
            )}
            {!micOk && (
              <p className="mono text-[9px] mt-2" style={{ color: 'var(--cw-red)' }}>AUDIO ENGINE OFFLINE — RELOAD AND REBOOT THE RIG</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


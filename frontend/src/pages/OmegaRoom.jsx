/* THE OMEGA ROOM — Ω.1 + Ω.2 + Ω.4 + Ω.5 live in here.

   No webcam, no matte, no live loop. A `.veyl` Performance File from the Vault
   (or a forged synthetic take, or a Motion Bank assembly built from your own
   recorded frames) drives the Synthetic Actor inside a real 3D world, framed by
   a free camera rig — the Stunt Engine can seize the body inside a takeover
   window — and every framed shot can be added to a `.veylep` EPISODE: an ordered
   cut assembled from many sources, continuity-checked on every edit, rendered
   end to end as one continuous file. The deliverable stops being a take. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createOmegaStage, RIG_BY_KEY } from '../studio/omegaStage';
import { createStunt, STUNT_PRESETS } from '../studio/stunt';
import { synthesizePerformance } from '../studio/perf';
import { buildBank, assemble, trainContinuation } from '../studio/motion';
import { makeEpisode, makeShot, checkContinuity, episodeDuration, downloadEpisode } from '../studio/shotlist';
import { conductEpisode, readRenderLedger, clearRenderLedger } from '../studio/omega';
import { vault, PERFORMANCES, EPISODES, exportPerf, importPerf } from '../studio/vault';
import { Recorder } from '../studio/recorder';
import { captureStill } from '../studio/novelview';
import { SourcePanel, RigPanel, OmegaWorldPanel, StuntPanel, MotionBankPanel, EpisodePanel, CinemaPanel } from '../components/studio/OmegaPanels';

const STILL_DUR = 4;

/* download an object URL RELIABLY: the anchor must live in the document —
   several browsers silently ignore .click() on a detached anchor */
function downloadUrl(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { try { a.remove(); } catch (_) {} }, 1000);
}

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
  const epRunRef = useRef(null);

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

  /* A4 — .veyl file transport + vault health line */
  const [importError, setImportError] = useState(null);
  const [usage, setUsage] = useState(null);
  const [persisted, setPersisted] = useState(false);

  /* Ω.3 — neural cinema: finish strength + the 2.5D still. Strength lives in a
     ref too so a slider move retunes the pass live instead of reloading the shot. */
  const [cinema, setCinema] = useState(0);
  const cinemaRef = useRef(0);
  const [still, setStill] = useState(null);

  /* Ω.2 — motion bank */
  const [bankBeats, setBankBeats] = useState([]);
  const [banking, setBanking] = useState(false);
  const bank = useMemo(() => (perfs.length ? buildBank(perfs) : null), [perfs]);
  /* Ω.2b — the gated continuation model, refit whenever the bank changes.
     Null below the corpus gate; assemble degrades to the linear blend. */
  const continuation = useMemo(() => (bank ? trainContinuation(bank) : null), [bank]);

  /* Ω.5 — the episode */
  const [episode, setEpisode] = useState(null);
  const [selectedShot, setSelectedShot] = useState(null);
  const [epRendering, setEpRendering] = useState(false);
  const [epShotIdx, setEpShotIdx] = useState(0);
  const [epPhase, setEpPhase] = useState('shot');
  /* Ω.0 — the render ledger: a truthful record of an interrupted render */
  const [renderDebt, setRenderDebt] = useState(() => {
    const l = readRenderLedger();
    return l && l.state !== 'complete' ? l : null;
  });
  const ledger = useMemo(() => (episode ? checkContinuity(episode.shots) : []), [episode]);
  const epDur = useMemo(() => (episode ? episodeDuration(episode.shots) : 0), [episode]);

  /* boot: stage + vault. If the vault is empty, forge a first synthetic take so
     the room (and every engine in it) works on day one with no camera ever opened. */
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
      const eps = await vault.all(EPISODES);
      const ep = eps[0] || makeEpisode({ name: 'episode-01' });
      if (eps.length === 0) await vault.put(EPISODES, ep);
      if (!alive) return;
      setPerfs(list);
      setActiveId(list[0].id);
      setWorld(list[0].world || 'nebula-drift');
      setEpisode(ep);
      setReady(true);
      /* vault health: quota usage + whether the browser granted persistence */
      try {
        if (navigator.storage) {
          if (navigator.storage.estimate) navigator.storage.estimate().then((e) => { if (alive) setUsage(e); }).catch(() => {});
          if (navigator.storage.persisted) navigator.storage.persisted().then((p) => { if (alive) setPersisted(!!p); }).catch(() => {});
        }
      } catch (_) { /* storage API unavailable */ }
    })();
    return () => { alive = false; if (epRunRef.current) epRunRef.current.stop(); stage.dispose(); };
  }, []);

  /* one function rebuilds the shot from current state — deterministic by design.
     Cinema strength is read from the ref, never the state, so a slider move
     retunes the live pass without tearing the shot down and resetting the clock. */
  const loadShot = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage || epRendering) return;

    /* Ω.3 — a frozen frame owns the room: the depth mesh IS the shot */
    if (still) {
      stage.load({
        performance: null, rig, world,
        in: 0, out: STILL_DUR,
        still, cinema: cinemaRef.current, cinemaSeed: still.seed || 11,
        label: `still · 2.5d dolly${cinemaRef.current > 0.004 ? ' · cinema' : ''}`,
      });
      setDuration(stage.duration);
      setTime(0);
      setPlaying(false);
      return;
    }

    const perf = activeId ? await vault.get(PERFORMANCES, activeId) : null;
    const dur = perf ? perf.duration : 6;
    let solver = null;
    let label = perf ? (perf.source === 'performed' ? 'performed' : perf.source === 'bank' ? 'bank' : 'synthetic') : 'synthetic';
    if (stunt && STUNT_BY_KEY[stunt]) {
      const s0 = Math.max(0, Math.min(dur - 1.2, stuntStart));
      const s1 = Math.min(dur - 0.05, s0 + stuntLen);
      solver = createStunt(STUNT_BY_KEY[stunt].make(s0, s1));
      label = `stunt · ${STUNT_BY_KEY[stunt].name.toLowerCase()}`;
    }
    stage.load({
      performance: perf, rig, world,
      in: 0, out: dur, stunt: solver,
      cinema: cinemaRef.current, cinemaSeed: 11,
      label: `${label} · ${(RIG_BY_KEY[rig] || RIG_BY_KEY.medium).badge}${cinemaRef.current > 0.004 ? ' · cinema' : ''}`,
    });
    setDuration(stage.duration);
    setTime(0);
    setPlaying(false);
  }, [activeId, rig, world, stunt, stuntStart, stuntLen, epRendering, still]);

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
    if (!stage || epRendering) return;
    stage.pause(); setPlaying(false);
    stage.seek(t); setTime(t);
  }, [epRendering]);

  /* Ω.3 — the cinema finish. Strength retunes the running pass live (the held
     frame re-renders in place); the A/B hold drops to the raw render and snaps
     back on release. All direction-track values — the shot never loses them. */
  const setCinemaStrength = useCallback((v) => {
    setCinema(v);
    cinemaRef.current = v;
    const stage = stageRef.current;
    if (stage && !epRendering) stage.setCinema(v);
  }, [epRendering]);

  const abDown = useCallback(() => {
    const stage = stageRef.current;
    if (stage && !epRendering) stage.setCinema(0);
  }, [epRendering]);

  const abUp = useCallback(() => {
    const stage = stageRef.current;
    if (stage && !epRendering) stage.setCinema(cinemaRef.current);
  }, [epRendering]);

  /* Ω.3 — freeze the framed viewport into a persistable still; the depth mesh is
     re-derived deterministically on every load, so the shot stays references-only */
  const freezeStill = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || epRendering || !canvasRef.current) return;
    stage.pause();
    setPlaying(false);
    /* the drawing buffer is cleared after compositing — re-render the held frame
       synchronously so the capture reads real pixels, never a cleared canvas */
    stage.seek(stage.time);
    const seed = 7 + (forgeSeed.current += 1);
    setStill(captureStill(canvasRef.current, { seed }));
  }, [epRendering]);

  const clearStill = useCallback(() => setStill(null), []);

  const forge = useCallback(async () => {
    const seed = forgeSeed.current += 6;
    const beats = FORGE_BEATS[seed % FORGE_BEATS.length];
    const perf = synthesizePerformance({
      name: `forged-take-${String(seed).padStart(2, '0')}`, beats, world, seed,
    });
    await vault.put(PERFORMANCES, perf);
    setPerfs(await vault.all(PERFORMANCES));
    setActiveId(perf.id);
  }, [world]);

  /* Ω.2 — assemble a take out of your own recorded frames, from a beat list */
  const assembleFromBank = useCallback(async () => {
    if (!bank || !bank.count || bankBeats.length === 0 || banking) return;
    setBanking(true);
    // let the button repaint before the (synchronous, deterministic) search runs
    await new Promise((r) => setTimeout(r, 30));
    const seed = 100 + (forgeSeed.current += 1);
    const perf = assemble(bank, {
      beats: bankBeats,
      name: `bank-shot-${String(seed - 100).padStart(2, '0')}`,
      world, seed, continuation,
    });
    setBanking(false);
    if (!perf) return;
    await vault.put(PERFORMANCES, perf);
    setPerfs(await vault.all(PERFORMANCES));
    setActiveId(perf.id);
    setBankBeats([]);
  }, [bank, bankBeats, banking, world, continuation]);

  /* A4 — .veyl transport: export a performance to disk, import one into the Vault */
  const exportVeyl = useCallback((perf) => {
    const blob = exportPerf(perf);
    const url = URL.createObjectURL(blob);
    downloadUrl(url, `${(perf.name || 'performance').replace(/[^a-z0-9-_]+/gi, '-')}.veyl`);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, []);

  const importVeyl = useCallback(async (file) => {
    setImportError(null);
    try {
      const record = await importPerf(file);
      await vault.put(PERFORMANCES, record);
      const list = await vault.all(PERFORMANCES);
      setPerfs(list);
      setActiveId(record.id);
      if (navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then(setUsage).catch(() => {});
      }
    } catch (err) {
      setImportError(err && err.message ? err.message : 'import failed');
    }
  }, []);

  /* Ω.5 — episode editing. Every mutation persists and re-runs the ledger. */
  const saveEpisode = useCallback(async (next) => {
    setEpisode(next);
    await vault.put(EPISODES, next);
  }, []);

  const addShot = useCallback(async () => {
    if (!episode) return;
    const perf = !still && activeId ? await vault.get(PERFORMANCES, activeId) : null;
    const shot = makeShot({
      perf, rig, world,
      stuntKey: still ? null : stunt, stuntStart, stuntLen,
      still, stillDur: STILL_DUR, cinema: cinemaRef.current,
    });
    await saveEpisode({ ...episode, shots: [...episode.shots, shot] });
    setSelectedShot(shot.id);
  }, [episode, activeId, rig, world, stunt, stuntStart, stuntLen, still, saveEpisode]);

  const selectShot = useCallback((id) => {
    if (!episode || epRendering) return;
    const shot = episode.shots.find((s) => s.id === id);
    if (!shot) return;
    setSelectedShot(id);
    // loading a shot back into the room restores the exact state that framed it
    setActiveId(shot.perfId);
    setRig(shot.rig);
    setWorld(shot.world);
    setStunt(shot.stunt ? shot.stunt.key : null);
    if (shot.stunt) { setStuntStart(shot.stunt.t0); setStuntLen(shot.stunt.len); }
    setStill(shot.still || null);
    const c = shot.cinema || 0;
    setCinema(c);
    cinemaRef.current = c;
  }, [episode, epRendering]);

  const moveShot = useCallback((i, dir) => {
    if (!episode) return;
    const next = [...episode.shots];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    saveEpisode({ ...episode, shots: next });
  }, [episode, saveEpisode]);

  const removeShot = useCallback((i) => {
    if (!episode) return;
    const next = episode.shots.filter((_, k) => k !== i);
    saveEpisode({ ...episode, shots: next });
  }, [episode, saveEpisode]);

  /* Ω.5 + Ω.0 — the episode render, run by the OMEGA CONDUCTOR: a planned
     shot queue rendered as one continuous recording, with breathers paused
     into the file after hot shots and a truthful render ledger throughout.
     The export IS the episode, end to end, in one file. */
  const renderEpisode = useCallback(async () => {
    const stage = stageRef.current;
    const rec = recorderRef.current;
    if (!stage || !episode || episode.shots.length === 0 || rec.recording || epRendering) return;
    const perfById = {};
    for (const shot of episode.shots) {
      if (shot.perfId && !perfById[shot.perfId]) {
        perfById[shot.perfId] = await vault.get(PERFORMANCES, shot.perfId);
      }
    }
    setEpRendering(true);
    setEpShotIdx(0);
    setEpPhase('shot');
    setRenderDebt(null);
    setDuration(episodeDuration(episode.shots));
    setTime(0);
    stage.pause();
    setPlaying(true);
    epRunRef.current = conductEpisode(stage, rec, episode, perfById, {
      onShot: (idx) => setEpShotIdx(idx),
      onTick: (total) => setTime(total),
      onPhase: (phase) => setEpPhase(phase),
      onEnd: (take) => {
        setPlaying(false);
        setEpRendering(false);
        epRunRef.current = null;
        if (take) {
          downloadUrl(take.url, `${episode.name}.${take.ext || 'webm'}`);
        }
        loadShot();
      },
    });
  }, [episode, epRendering, loadShot]);

  const dismissDebt = useCallback(() => { clearRenderLedger(); setRenderDebt(null); }, []);

  /* offline render of the single framed shot — unchanged path */
  const exportShot = useCallback(() => {
    const stage = stageRef.current;
    const rec = recorderRef.current;
    if (!stage || rec.recording || exporting || epRendering) return;
    stage.pause(); stage.seek(0); setTime(0);
    if (!rec.start(stage, null)) return;   // encoder refused at every tier — no phantom export
    setExporting(true);
    setPlaying(true);
    stage.play({
      onTick: (t) => setTime(t),
      onEnd: async () => {
        setPlaying(false);
        const take = await rec.stop();
        setExporting(false);
        if (take) {
          downloadUrl(take.url, `omega-${stunt ? stunt : 'shot'}-${rig}.${take.ext || 'webm'}`);
        }
      },
    });
  }, [exporting, epRendering, rig, stunt]);

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`;

  return (
    <div className="min-h-screen" data-testid="omega-root">
      <header className="flex items-center gap-4 px-4 py-2.5" style={{ borderBottom: '1px solid var(--cw-border)' }}>
        <span className="mono font-bold text-sm tracking-widest" data-testid="omega-brand">
          COSMIC WEAVER <span style={{ color: 'var(--cw-red)' }}>// OMEGA ROOM</span>
        </span>
        <span className="mono text-[9px] hidden md:inline" style={{ color: 'var(--cw-muted)' }}>
          SYNTHETIC ACTOR · MOTION BANK · STUNT ENGINE · EPISODE CUT · NO CAMERA REQUIRED
        </span>
        <div className="flex-1" />
        <Link to="/" className="cw-chip" style={{ padding: '8px 14px', textDecoration: 'none' }} data-testid="omega-back-link">
          <span>← LIVE STUDIO</span>
        </Link>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-12 gap-3 p-3">
        {/* left rail: what drives the body, where it stands, what the bank can build */}
        <div className="lg:col-span-3 space-y-3 order-2 lg:order-1">
          <SourcePanel perfs={perfs} activeId={activeId} memoryOnly={vault.isMemoryOnly}
            onPick={(id) => setActiveId(id)} onForge={forge}
            onExport={exportVeyl} onImport={importVeyl} importError={importError}
            usage={usage} persisted={persisted} />
          <MotionBankPanel bank={bank} beats={bankBeats} onBeats={setBankBeats}
            onAssemble={assembleFromBank} busy={banking} continuation={continuation} />
          <OmegaWorldPanel world={world} onWorld={setWorld} />
        </div>

        {/* viewport + transport */}
        <div className="lg:col-span-5 order-1 lg:order-2">
          <div className="cw-viewport mx-auto" style={{ aspectRatio: '9/16', maxHeight: 'calc(100vh - 150px)' }} data-testid="omega-viewport">
            <canvas ref={canvasRef} width={1080} height={1920} data-testid="omega-canvas" />
            <div className="cw-scanlines" />
          </div>
          <div className="flex items-center gap-3 mt-2 px-1" data-testid="omega-transport">
            <button className={`cw-rec ${playing ? 'live' : ''}`} disabled={!ready || exporting || epRendering}
              data-testid="omega-play-btn" onClick={play}>
              {playing ? '❚❚' : '▶'}
            </button>
            <span className="mono text-[10px] w-20" style={{ color: 'var(--cw-text-2)' }} data-testid="omega-clock">
              {fmt(time)}
            </span>
            <input type="range" className="flex-1" min={0} max={Math.max(0.1, duration)} step={0.033}
              value={Math.min(time, duration)} data-testid="omega-scrub" disabled={epRendering}
              onChange={(e) => seek(parseFloat(e.target.value))} />
            <span className="mono text-[10px]" style={{ color: 'var(--cw-muted)' }}>{fmt(duration)}</span>
          </div>
        </div>

        {/* right rail: the camera, the physics, the cut */}
        <div className="lg:col-span-4 space-y-3 order-3">
          <RigPanel rig={rig} onRig={setRig} />
          {/* a still shot has no body to seize — physics yields the panel to the dolly */}
          {!still && (
            <StuntPanel stunt={stunt} onStunt={setStunt} dur={duration || 6}
              start={stuntStart} len={stuntLen} onStart={setStuntStart} onLen={setStuntLen} />
          )}
          <CinemaPanel strength={cinema} onStrength={setCinemaStrength}
            onABDown={abDown} onABUp={abUp} onFreeze={freezeStill}
            still={still} onClearStill={clearStill} disabled={!ready || epRendering} />
          <EpisodePanel shots={episode ? episode.shots : []} ledger={ledger} totalDur={epDur}
            selected={selectedShot} canAdd={ready && !epRendering}
            onAdd={addShot} onSelect={selectShot} onMove={moveShot} onRemove={removeShot}
            onRender={renderEpisode} onDownload={() => episode && downloadEpisode(episode)}
            rendering={epRendering} renderIdx={epShotIdx} phase={epPhase}
            debt={renderDebt} onDismissDebt={dismissDebt} />
          <div className="cw-panel" data-testid="omega-export-panel">
            <h2>⇩ Render Shot</h2>
            <button className="cw-rec w-full" disabled={!ready || exporting || playing || epRendering}
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

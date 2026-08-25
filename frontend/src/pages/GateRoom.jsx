/* THE GATE ROOM — RECOVERY 1.3 + 2 #4, the falsifiable gates.

   Left: the five worlds' first frames, rendered through the EXACT production
   pipeline (omega stage: same worlds, same ACES + horror grade, same handheld
   frame), fingerprinted with a 64-bit dHash, checked pairwise — no two
   consecutive uploads may share a door the feed can't tell apart (2026 YPP
   repetition policy). Exported first frames of REAL upload candidates can be
   dropped in to run the same rule on the actual files.

   Right: the freeze-frame test. 5 renders shuffled with 5 real NASA stills,
   each flashed for exactly 1 second, tester calls REAL or FAKE. Pass = at
   least 2 of 5 renders misidentified as real; the gate opens on a majority of
   the 3-tester panel. Until it opens, Phase 3 (the re-doored Sun Signal
   upload) is locked — by the plan, not by mood. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createOmegaStage } from '../studio/omegaStage';
import {
  dhash, fingerprintReport, decodeImageFile,
  buildDeck, scoreRun, readGate, saveRun, clearGate,
  DOOR_MIN_DIST, PASS_MIN_FOOLED, REAL_STILLS,
} from '../studio/gate';

const WORLDS = [
  { key: 'dying-star', name: 'DYING STAR' },
  { key: 'asteroid-earth', name: 'ASTEROID EARTH' },
  { key: 'nebula-drift', name: 'NEBULA DRIFT' },
  { key: 'derelict-station', name: 'DERELICT STATION' },
  { key: 'red-planet', name: 'RED PLANET' },
];

const FLASH_MS = 1000; // the plan's 1 second, exactly

const C = {
  text: 'var(--cw-text)',
  text2: 'var(--cw-text-2)',
  muted: 'var(--cw-muted)',
  green: 'var(--cw-green)',
  red: 'var(--cw-red)',
  cyan: 'var(--cw-cyan)',
  border: '1px solid var(--cw-border)',
};

export default function GateRoom() {
  const hiddenRef = useRef(null);
  const [renders, setRenders] = useState([]);   // { key, label, src, hash }
  const [uploads, setUploads] = useState([]);   // { label, src, hash }
  const [gate, setGate] = useState(readGate());

  /* flash-test state machine: idle → flash → answer → (next…) → done */
  const [test, setTest] = useState({ phase: 'idle' });

  /* ---- render the 5 first frames through the production pipeline ---- */
  useEffect(() => {
    const canvas = hiddenRef.current;
    if (!canvas) return undefined;
    let stage = null;
    let cancelled = false;
    try {
      stage = createOmegaStage(canvas);
    } catch (err) {
      console.error('[gate] stage unavailable', err);
      return undefined;
    }
    const out = [];
    const shoot = (i) => {
      if (cancelled || i >= WORLDS.length) {
        if (!cancelled) setRenders(out.slice());
        return;
      }
      const w = WORLDS[i];
      try {
        /* frame zero, medium rig — the door the feed actually sees */
        stage.load({ world: w.key, rig: 'medium', in: 0, out: 1 });
        stage.seek(0.001); // renders synchronously — grab pixels in this same task
        const thumb = document.createElement('canvas');
        thumb.width = 270; thumb.height = 480;
        thumb.getContext('2d').drawImage(canvas, 0, 0, 270, 480);
        out.push({ key: w.key, label: w.name, src: thumb.toDataURL('image/jpeg', 0.85), hash: dhash(thumb) });
      } catch (err) {
        console.error('[gate] first-frame render failed', w.key, err);
      }
      /* one world per frame: shader compiles never freeze the page */
      requestAnimationFrame(() => shoot(i + 1));
    };
    shoot(0);
    return () => { cancelled = true; try { stage.dispose(); } catch (_) { /* torn down */ } };
  }, []);

  /* ---- fingerprint uploaded first frames (real upload candidates) ---- */
  const onFiles = useCallback(async (e) => {
    const files = Array.from(e.target.files || []);
    const added = [];
    for (const f of files) {
      try {
        const { img, url } = await decodeImageFile(f);
        added.push({ label: f.name.toUpperCase(), src: url, hash: dhash(img) });
      } catch (_) { /* skip undecodable */ }
    }
    setUploads((u) => [...u, ...added]);
    e.target.value = '';
  }, []);

  /* ---- flash test ---- */
  const startTest = useCallback(() => {
    if (renders.length < 5) return;
    const deck = buildDeck(
      renders.map((r) => ({ src: r.src, label: r.label })),
      REAL_STILLS,
    );
    setTest({ phase: 'flash', deck, idx: 0, answers: [] });
  }, [renders]);

  useEffect(() => {
    if (test.phase !== 'flash') return undefined;
    const t = setTimeout(() => setTest((s) => ({ ...s, phase: 'answer' })), FLASH_MS);
    return () => clearTimeout(t);
  }, [test.phase, test.idx]);

  const answer = useCallback((call) => {
    setTest((s) => {
      const answers = [...s.answers, call];
      if (answers.length >= s.deck.cards.length) {
        const score = scoreRun(s.deck, answers);
        const g = saveRun({ seed: s.deck.seed, fooled: score.fooled, realsCaught: score.realsCaught, pass: score.pass });
        setGate(g);
        return { phase: 'done', deck: s.deck, answers, score };
      }
      return { ...s, phase: 'flash', idx: s.idx + 1, answers };
    });
  }, []);

  const resetGate = useCallback(() => { clearGate(); setGate(readGate()); }, []);

  const autoReport = fingerprintReport(renders);
  const uploadReport = fingerprintReport(uploads);
  const passingRuns = gate.runs.filter((r) => r.pass).length;
  const open = Boolean(gate.passedAt);

  return (
    <div className="mono min-h-screen" data-testid="gate-room" style={{ color: C.text }}>
      {/* production-pipeline render target: full frame, never displayed */}
      <canvas ref={hiddenRef} width={1080} height={1920} className="sr-only" aria-hidden="true" />

      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3" style={{ borderBottom: C.border }}>
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm tracking-widest m-0">⨂ THE GATE</h1>
          <span className="text-[10px] hidden md:inline" style={{ color: C.muted }}>RECOVERY 1.3 + 2#4 — FALSIFIABLE, PRE-COMMITTED</span>
        </div>
        <nav className="flex items-center gap-2">
          <Link to="/" className="cw-chip text-[10px]" style={{ padding: '8px 14px', textDecoration: 'none' }} data-testid="studio-link">STUDIO</Link>
          <Link to="/omega" className="cw-chip text-[10px]" style={{ padding: '8px 14px', textDecoration: 'none' }}>Ω OMEGA ROOM</Link>
          <Link to="/retest" className="cw-chip text-[10px]" style={{ padding: '8px 14px', textDecoration: 'none' }} data-testid="retest-link">⨁ RE-TEST</Link>
        </nav>
      </header>

      {/* GATE STATUS — the number that unlocks Phase 3 */}
      <section aria-label="Gate status" className="mx-5 mt-4 px-4 py-3 flex flex-wrap items-center justify-between gap-2"
        style={{ border: `1px solid ${open ? 'rgba(0,255,65,0.5)' : 'var(--cw-border-hot)'}` }} data-testid="gate-status">
        <p className="text-[11px] tracking-widest m-0" style={{ color: open ? C.green : C.red }}>
          {open
            ? 'GATE OPEN — PHASE 3 UNLOCKED: RE-DOOR THE SUN SIGNAL, PUBLISH, WAIT 72H, READ THE TWO NUMBERS'
            : `PHASE 3 LOCKED — ${passingRuns}/2 PASSING TESTER RUNS (PANEL OF 3, MAJORITY OPENS THE GATE)`}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[10px]" style={{ color: C.muted }}>{gate.runs.length} RUN{gate.runs.length === 1 ? '' : 'S'} LOGGED</span>
          {gate.runs.length > 0 && (
            <button type="button" onClick={resetGate} className="cw-chip text-[10px]" style={{ padding: '6px 10px' }} data-testid="gate-reset">RESET LEDGER</button>
          )}
        </div>
      </section>

      <main className="grid gap-5 p-5 lg:grid-cols-2">
        {/* ---------------- FINGERPRINT GATE ---------------- */}
        <section aria-label="First-frame fingerprint gate" className="cw-panel p-4 flex flex-col gap-4">
          <div>
            <h2 className="text-xs tracking-widest m-0">◈ FIRST-FRAME FINGERPRINT — YPP RULE</h2>
            <p className="text-[10px] leading-relaxed mt-1 mb-0" style={{ color: C.text2 }}>
              64-BIT dHASH PER DOOR. CONSECUTIVE UPLOADS MUST DIFFER BY ≥ {DOOR_MIN_DIST}/64 BITS —
              BELOW THAT THE FEED (AND 2026 YPP POLICY) READS THEM AS ONE VIDEO REPOSTED.
            </p>
          </div>

          <div className="grid grid-cols-5 gap-2" data-testid="gate-first-frames">
            {WORLDS.map((w) => {
              const r = renders.find((x) => x.key === w.key);
              return (
                <figure key={w.key} className="flex flex-col gap-1 m-0">
                  {r
                    ? <img src={r.src || "/placeholder.svg"} alt={`Pipeline first frame — ${w.name}`} className="w-full aspect-[9/16] object-cover" style={{ border: C.border }} />
                    : <div className="w-full aspect-[9/16] flex items-center justify-center" style={{ border: C.border }}><span className="text-[9px]" style={{ color: C.muted }}>RENDERING…</span></div>}
                  <figcaption className="text-[9px] truncate" style={{ color: C.muted }}>{w.name}</figcaption>
                  {r && <span className="text-[8px] break-all leading-tight" style={{ color: C.cyan }}>{r.hash}</span>}
                </figure>
              );
            })}
          </div>

          {autoReport.pairs.length > 0 && (
            <ul className="flex flex-col gap-1 list-none m-0 p-0" data-testid="gate-fingerprint-report">
              {autoReport.pairs.map((p) => (
                <li key={`${p.a}-${p.b}`} className="flex items-center justify-between text-[10px]">
                  <span style={{ color: C.muted }}>{p.a} → {p.b}</span>
                  <span style={{ color: p.ok ? C.green : C.red }}>{p.dist}/64 {p.ok ? 'DISTINCT' : `REPOST-READ (< ${DOOR_MIN_DIST})`}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="pt-3 flex flex-col gap-2" style={{ borderTop: C.border }}>
            <label htmlFor="gate-upload" className="text-[10px] tracking-widest">
              CHECK REAL UPLOAD CANDIDATES — DROP EXPORTED FIRST FRAMES IN UPLOAD ORDER
            </label>
            <input id="gate-upload" type="file" accept="image/*" multiple onChange={onFiles}
              className="text-[10px]" style={{ color: C.text2 }} data-testid="gate-upload" />
            {uploads.length > 0 && (
              <>
                <div className="flex gap-2 flex-wrap">
                  {uploads.map((u) => (
                    <figure key={u.src} className="m-0 flex flex-col gap-1 w-16">
                      <img src={u.src || "/placeholder.svg"} alt={`Upload candidate first frame — ${u.label}`} className="w-16 aspect-[9/16] object-cover" style={{ border: C.border }} />
                      <figcaption className="text-[8px] truncate" style={{ color: C.muted }}>{u.label}</figcaption>
                    </figure>
                  ))}
                </div>
                {uploadReport.pairs.length > 0 && (
                  <p className="text-[10px] m-0" style={{ color: uploadReport.pass ? C.green : C.red }} data-testid="gate-upload-verdict">
                    {uploadReport.pass
                      ? 'EVERY CONSECUTIVE PAIR DISTINCT — CLEAR TO SCHEDULE'
                      : `${uploadReport.violations} CONSECUTIVE PAIR(S) READ AS REPOSTS — RE-DOOR BEFORE UPLOADING`}
                  </p>
                )}
              </>
            )}
          </div>
        </section>

        {/* ---------------- FREEZE-FRAME TEST ---------------- */}
        <section aria-label="Freeze-frame acceptance test" className="cw-panel p-4 flex flex-col gap-4">
          <div>
            <h2 className="text-xs tracking-widest m-0">◬ FREEZE-FRAME TEST — RECOVERY 1.3</h2>
            <p className="text-[10px] leading-relaxed mt-1 mb-0" style={{ color: C.text2 }}>
              10 STILLS — 5 PIPELINE RENDERS, 5 REAL NASA FRAMES — EACH FLASHED FOR 1 SECOND.
              HAND THE DEVICE TO A TESTER. PASS = ≥ {PASS_MIN_FOOLED} OF 5 RENDERS CALLED REAL.
            </p>
          </div>

          {test.phase === 'idle' && (
            <button type="button" onClick={startTest} disabled={renders.length < 5}
              className="cw-chip text-xs tracking-widest disabled:opacity-40" style={{ padding: '12px 16px' }} data-testid="gate-start-test">
              {renders.length < 5 ? 'RENDERING FIRST FRAMES…' : '▶ START A TESTER RUN'}
            </button>
          )}

          {(test.phase === 'flash' || test.phase === 'answer') && (
            <div className="flex flex-col items-center gap-3">
              <p className="text-[10px] m-0" style={{ color: C.muted }}>STILL {test.idx + 1} / {test.deck.cards.length}</p>
              <div className="w-56 aspect-[9/16] flex items-center justify-center overflow-hidden" style={{ border: C.border, background: '#000' }}>
                {test.phase === 'flash'
                  ? <img src={test.deck.cards[test.idx].src || "/placeholder.svg"} alt="Test still — real or fake?" className="w-full h-full object-contain" data-testid="gate-flash-img" />
                  : <span className="text-[10px]" style={{ color: C.muted }}>GONE. REAL OR FAKE?</span>}
              </div>
              {test.phase === 'answer' && (
                <div className="flex gap-3">
                  <button type="button" onClick={() => answer('real')} className="cw-chip text-xs" style={{ padding: '12px 24px', color: C.green }} data-testid="gate-answer-real">REAL</button>
                  <button type="button" onClick={() => answer('fake')} className="cw-chip text-xs" style={{ padding: '12px 24px', color: C.red }} data-testid="gate-answer-fake">FAKE</button>
                </div>
              )}
            </div>
          )}

          {test.phase === 'done' && (
            <div className="flex flex-col gap-2" data-testid="gate-run-result">
              <p className="text-sm tracking-widest m-0" style={{ color: test.score.pass ? C.green : C.red }}>
                {test.score.fooled}/5 RENDERS READ AS REAL — {test.score.pass ? 'RUN PASSED' : 'RUN FAILED'}
              </p>
              <p className="text-[10px] m-0" style={{ color: C.muted }}>
                ({test.score.realsCaught}/5 REAL FRAMES CORRECTLY CALLED REAL — A TESTER WHO CALLS
                EVERYTHING FAKE PROVES NOTHING; A TESTER WHO CALLS EVERYTHING REAL PROVES LESS.)
              </p>
              <button type="button" onClick={() => setTest({ phase: 'idle' })} className="cw-chip text-[10px] self-start" style={{ padding: '8px 12px' }} data-testid="gate-next-tester">
                NEXT TESTER
              </button>
            </div>
          )}

          {gate.runs.length > 0 && (
            <ul className="pt-3 flex flex-col gap-1 list-none m-0 p-0" style={{ borderTop: C.border }} data-testid="gate-run-ledger">
              {gate.runs.map((r, i) => (
                <li key={r.at} className="flex items-center justify-between text-[10px]">
                  <span style={{ color: C.muted }}>RUN {i + 1} · SEED {r.seed}</span>
                  <span style={{ color: r.pass ? C.green : C.red }}>{r.fooled}/5 FOOLED — {r.pass ? 'PASS' : 'FAIL'}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

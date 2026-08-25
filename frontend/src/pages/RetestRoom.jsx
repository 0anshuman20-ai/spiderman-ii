/* THE RE-TEST ROOM — RECOVERY 3 + 4, the last instrument.

   "Read the two numbers. Follow the tripwire table. Nothing else."

   Left: the ledger. Every upload is logged at publish time; its verdict is
   locked for 72 hours (a seed test read early is a lie), then computed from
   exactly two numbers against the rolling channel median — never against a
   universal benchmark, never against mood. The pre-committed action from
   memory/RECOVERY_PLAN.md section 4 is printed verbatim. The pre-recovery
   measured uploads seed the baseline so the median exists from day zero.

   Right: the geography tripwires (30 days post-relaunch) and the plan's
   own text, so the person reading the number is looking at the rule that
   binds them while they read it. */
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { gateOpen } from '../studio/gate';
import {
  readLedger, addEntry, updateEntry, removeEntry, clearLedger,
  channelMedian, evaluate, geoVerdict,
  READ_DELAY_H, RATIO_CONFIRMED, RATIO_PARTIAL, BASELINE_WINDOW,
} from '../studio/tripwire';

const C = {
  text: 'var(--cw-text)',
  text2: 'var(--cw-text-2)',
  muted: 'var(--cw-muted)',
  green: 'var(--cw-green)',
  red: 'var(--cw-red)',
  cyan: 'var(--cw-cyan)',
  amber: '#ffb347',
  border: '1px solid var(--cw-border)',
};

const STATE_COLOR = {
  confirmed: C.green,
  partial: C.amber,
  failed: C.red,
  waiting: C.cyan,
  unread: C.muted,
};

const num = (v) => {
  const n = parseFloat(v);
  return isFinite(n) ? n : undefined;
};

function Field({ id, label, value, onChange, width = 'w-20', placeholder = '' }) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-[9px] tracking-widest" style={{ color: C.muted }}>
      {label}
      <input id={id} type="text" inputMode="decimal" value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${width} bg-transparent px-2 py-1 text-[11px]`}
        style={{ border: C.border, color: C.text }} />
    </label>
  );
}

export default function RetestRoom() {
  const [ledger, setLedger] = useState(readLedger());
  const [now, setNow] = useState(Date.now());
  const phase3 = gateOpen();

  /* new-entry form */
  const [form, setForm] = useState({ label: '', publishedAt: '', views: '', stayedPct: '', avdSec: '', lenSec: '', swipe3sPct: '' });
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  /* per-entry number edits (unread entries filled in after the 72h window) */
  const [edits, setEdits] = useState({}); // id -> {stayedPct, avdSec, swipe3sPct}

  /* geo tripwires */
  const [geo, setGeo] = useState({ indiaPct: '', usUkEuPct: '', weakRpm: false });

  const refresh = useCallback((l) => { setLedger(l); setNow(Date.now()); }, []);

  const submit = useCallback((e) => {
    e.preventDefault();
    if (!form.label.trim()) return;
    refresh(addEntry({
      label: form.label.trim().toUpperCase(),
      publishedAt: form.publishedAt ? Date.parse(form.publishedAt) : Date.now(),
      views: num(form.views),
      stayedPct: num(form.stayedPct),
      avdSec: num(form.avdSec),
      lenSec: num(form.lenSec),
      swipe3sPct: num(form.swipe3sPct),
    }));
    setForm({ label: '', publishedAt: '', views: '', stayedPct: '', avdSec: '', lenSec: '', swipe3sPct: '' });
  }, [form, refresh]);

  const saveNumbers = useCallback((id) => {
    const e = edits[id] || {};
    refresh(updateEntry(id, {
      stayedPct: num(e.stayedPct),
      avdSec: num(e.avdSec),
      swipe3sPct: num(e.swipe3sPct),
    }));
    setEdits((x) => { const y = { ...x }; delete y[id]; return y; });
  }, [edits, refresh]);

  const base = useMemo(() => channelMedian(ledger.entries), [ledger]);
  const geoResult = geoVerdict({ indiaPct: num(geo.indiaPct), usUkEuPct: num(geo.usUkEuPct), weakRpm: geo.weakRpm });

  return (
    <div className="mono min-h-screen" data-testid="retest-room" style={{ color: C.text }}>
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3" style={{ borderBottom: C.border }}>
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm tracking-widest m-0">⨁ THE RE-TEST</h1>
          <span className="text-[10px] hidden md:inline" style={{ color: C.muted }}>
            RECOVERY 3+4 — TWO NUMBERS, ONE TABLE, ZERO MOOD
          </span>
        </div>
        <nav className="flex items-center gap-2">
          <Link to="/" className="cw-chip text-[10px]" style={{ padding: '8px 14px', textDecoration: 'none' }} data-testid="studio-link">STUDIO</Link>
          <Link to="/omega" className="cw-chip text-[10px]" style={{ padding: '8px 14px', textDecoration: 'none' }}>Ω OMEGA ROOM</Link>
          <Link to="/gate" className="cw-chip text-[10px]" style={{ padding: '8px 14px', textDecoration: 'none' }}>⨂ THE GATE</Link>
        </nav>
      </header>

      {/* PHASE 3 STATE — inherited from the gate, never asserted here */}
      <section aria-label="Phase 3 state" className="mx-5 mt-4 px-4 py-3 flex flex-wrap items-center justify-between gap-2"
        style={{ border: `1px solid ${phase3 ? 'rgba(0,255,65,0.5)' : 'var(--cw-border-hot)'}` }} data-testid="retest-phase-state">
        <p className="text-[11px] tracking-widest m-0" style={{ color: phase3 ? C.green : C.red }}>
          {phase3
            ? 'GATE OPEN — PUBLISH THE RE-DOORED SUN SIGNAL, LOG IT BELOW, WAIT 72H, READ THE TWO NUMBERS'
            : 'GATE CLOSED — THE FREEZE-FRAME TEST HAS NOT PASSED. LOGGING IS OPEN; PUBLISHING IS NOT.'}
        </p>
        <div className="flex items-center gap-3">
          <span className="text-[10px]" style={{ color: C.cyan }} data-testid="retest-baseline">
            CHANNEL MEDIAN {base.median.toFixed(1)}% · LAST {Math.min(base.n, BASELINE_WINDOW)} MEASURED
            {base.fallback ? ' · FALLBACK' : ''}
          </span>
          <button type="button" onClick={() => refresh(clearLedger())} className="cw-chip text-[10px]" style={{ padding: '6px 10px' }} data-testid="retest-reset">
            RESET LEDGER
          </button>
        </div>
      </section>

      <main className="grid gap-5 p-5 lg:grid-cols-[3fr_2fr]">
        {/* ---------------- THE LEDGER ---------------- */}
        <section aria-label="Upload ledger and verdicts" className="cw-panel p-4 flex flex-col gap-4">
          <div>
            <h2 className="text-xs tracking-widest m-0">◎ THE LEDGER — ONE ROW PER UPLOAD</h2>
            <p className="text-[10px] leading-relaxed mt-1 mb-0" style={{ color: C.text2 }}>
              LOG AT PUBLISH. THE VERDICT IS SEALED FOR {READ_DELAY_H}H, THEN COMPUTED AGAINST THE ROLLING
              MEDIAN OF THE LAST {BASELINE_WINDOW} SHORTS: ≥{RATIO_CONFIRMED}x CONFIRMS THE DOOR,
              {' '}{RATIO_PARTIAL}–{RATIO_CONFIRMED}x ITERATES FRAME ZERO ONLY, BELOW {RATIO_PARTIAL}x
              THE CHARACTER EXITS THE COLD OPEN.
            </p>
          </div>

          {/* log form */}
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3 pb-3" style={{ borderBottom: C.border }} data-testid="retest-form">
            <Field id="rt-label" label="SIGNAL / TITLE" width="w-48" value={form.label} onChange={set('label')} placeholder="SUN SIGNAL — RE-DOOR" />
            <label htmlFor="rt-published" className="flex flex-col gap-1 text-[9px] tracking-widest" style={{ color: C.muted }}>
              PUBLISHED
              <input id="rt-published" type="datetime-local" value={form.publishedAt} onChange={(e) => set('publishedAt')(e.target.value)}
                className="bg-transparent px-2 py-1 text-[11px]" style={{ border: C.border, color: C.text, colorScheme: 'dark' }} />
            </label>
            <Field id="rt-views" label="VIEWS" value={form.views} onChange={set('views')} />
            <Field id="rt-stayed" label="STAYED %" value={form.stayedPct} onChange={set('stayedPct')} />
            <Field id="rt-avd" label="AVD (S)" value={form.avdSec} onChange={set('avdSec')} />
            <Field id="rt-len" label="LENGTH (S)" value={form.lenSec} onChange={set('lenSec')} />
            <Field id="rt-swipe" label="SWIPE 3S %" value={form.swipe3sPct} onChange={set('swipe3sPct')} />
            <button type="submit" className="cw-chip text-[10px] tracking-widest" style={{ padding: '10px 16px' }} data-testid="retest-add">
              + LOG UPLOAD
            </button>
          </form>

          {/* rows */}
          <ul className="flex flex-col gap-3 list-none m-0 p-0" data-testid="retest-ledger">
            {ledger.entries.slice().reverse().map((e) => {
              const v = evaluate(e, ledger.entries, now);
              const color = STATE_COLOR[v.state] || C.muted;
              const ed = edits[e.id];
              return (
                <li key={e.id} className="flex flex-col gap-2 p-3" style={{ border: C.border }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] tracking-widest">{e.label}</span>
                    <div className="flex items-center gap-3 text-[10px]" style={{ color: C.muted }}>
                      {typeof e.views === 'number' && <span>{e.views} VIEWS</span>}
                      {typeof e.stayedPct === 'number' && <span style={{ color: C.text2 }}>{e.stayedPct}% STAYED</span>}
                      {typeof e.avdSec === 'number' && <span>{e.avdSec}s AVD{e.lenSec ? ` / ${e.lenSec}s` : ''}</span>}
                      {typeof v.ratio === 'number' && (
                        <span style={{ color }}>{v.ratio.toFixed(2)}x MEDIAN ({v.baseline.toFixed(1)}%)</span>
                      )}
                      {!e.seed && (
                        <button type="button" onClick={() => refresh(removeEntry(e.id))} className="cw-chip text-[9px]" style={{ padding: '4px 8px' }}
                          aria-label={`Remove ${e.label}`}>✕</button>
                      )}
                    </div>
                  </div>

                  <p className="text-[10px] tracking-wider m-0" style={{ color }} data-testid={`retest-verdict-${e.id}`}>
                    {v.state === 'waiting'
                      ? `${v.action} READS AT ${new Date(v.readAt).toLocaleString()}.`
                      : v.action}
                  </p>
                  {v.secondary.map((s) => (
                    <p key={s} className="text-[10px] m-0" style={{ color: C.text2 }}>↳ {s}</p>
                  ))}
                  {e.note && <p className="text-[9px] m-0" style={{ color: C.muted }}>{e.note}</p>}

                  {/* fill in the two numbers once the window elapses */}
                  {v.state === 'unread' && (
                    <div className="flex flex-wrap items-end gap-3 pt-2" style={{ borderTop: C.border }}>
                      <Field id={`ed-stayed-${e.id}`} label="STAYED %"
                        value={ed?.stayedPct ?? ''} onChange={(x) => setEdits((s) => ({ ...s, [e.id]: { ...s[e.id], stayedPct: x } }))} />
                      <Field id={`ed-avd-${e.id}`} label="AVD (S)"
                        value={ed?.avdSec ?? ''} onChange={(x) => setEdits((s) => ({ ...s, [e.id]: { ...s[e.id], avdSec: x } }))} />
                      <Field id={`ed-swipe-${e.id}`} label="SWIPE 3S %"
                        value={ed?.swipe3sPct ?? ''} onChange={(x) => setEdits((s) => ({ ...s, [e.id]: { ...s[e.id], swipe3sPct: x } }))} />
                      <button type="button" onClick={() => saveNumbers(e.id)} className="cw-chip text-[10px]" style={{ padding: '8px 14px' }}
                        data-testid={`retest-save-${e.id}`}>READ THE NUMBERS</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {/* ---------------- GEO TRIPWIRES + THE TABLE ---------------- */}
        <div className="flex flex-col gap-5">
          <section aria-label="Geography tripwires" className="cw-panel p-4 flex flex-col gap-3">
            <div>
              <h2 className="text-xs tracking-widest m-0">◍ 30-DAY GEOGRAPHY TRIPWIRES</h2>
              <p className="text-[10px] leading-relaxed mt-1 mb-0" style={{ color: C.text2 }}>
                READ ONCE FROM YOUTUBE STUDIO GEOGRAPHY, 30 DAYS POST-RELAUNCH. LANGUAGE IS DOWNSTREAM
                OF THIS DATA AND NOTHING ELSE.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field id="geo-india" label="INDIA %" value={geo.indiaPct} onChange={(v) => setGeo((g) => ({ ...g, indiaPct: v }))} />
              <Field id="geo-west" label="US/UK/EU %" value={geo.usUkEuPct} onChange={(v) => setGeo((g) => ({ ...g, usUkEuPct: v }))} />
              <label htmlFor="geo-rpm" className="flex items-center gap-2 text-[9px] tracking-widest pb-1" style={{ color: C.muted }}>
                <input id="geo-rpm" type="checkbox" checked={geo.weakRpm} onChange={(e) => setGeo((g) => ({ ...g, weakRpm: e.target.checked }))} />
                WEAK RPM
              </label>
            </div>
            <p className="text-[10px] tracking-wider m-0" style={{ color: C.cyan }} data-testid="retest-geo-verdict">{geoResult}</p>
          </section>

          <section aria-label="The pre-committed table" className="cw-panel p-4 flex flex-col gap-2">
            <h2 className="text-xs tracking-widest m-0">▤ THE TABLE — PRE-COMMITTED, VERBATIM</h2>
            <ul className="flex flex-col gap-2 list-none m-0 p-0 text-[10px] leading-relaxed" style={{ color: C.text2 }}>
              <li><span style={{ color: C.green }}>≥ 2x MEDIAN</span> — door confirmed. Re-door top 5, resume 48h cadence.</li>
              <li><span style={{ color: C.amber }}>1.3–2x MEDIAN</span> — partial. Iterate frame zero only; second re-test.</li>
              <li><span style={{ color: C.red }}>&lt; 1.3x MEDIAN</span> — character exits the cold open channel-wide; anomaly-first format.</li>
              <li><span style={{ color: C.text }}>SWIPE 3S &lt; 35%</span> — past the failure line. Iterate from strength.</li>
              <li><span style={{ color: C.text }}>SWIPE 3S &lt; 25%</span> — healthy. Freeze that opening as the channel template.</li>
              <li><span style={{ color: C.muted }}>ROLLING BASELINE</span> — median over the last {BASELINE_WINDOW} measured Shorts, recomputed on every read.</li>
            </ul>
            <p className="text-[9px] leading-relaxed m-0 pt-2" style={{ color: C.muted, borderTop: C.border }}>
              NOT ON TRIAL: THE 46 SCRIPTS, THE LANGUAGE, THE NICHE, THE Ω ROADMAP.
              THE ONLY VARIABLE IS THE DOOR. READ THE TWO NUMBERS. FOLLOW THE TABLE. NOTHING ELSE.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

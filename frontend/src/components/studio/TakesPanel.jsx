import { useState } from 'react';

const fmtSize = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const TakesPanel = ({ takes, onDelete }) => {
  /* inline preview: one take open at a time; clicking the name toggles it */
  const [previewId, setPreviewId] = useState(null);
  return (
    <div className="cw-panel" data-testid="takes-panel">
      <h2>◉ Takes — This Session ({takes.length})</h2>
      {takes.length === 0 && (
        <div className="mono text-[10px]" style={{ color: 'var(--cw-muted)' }}>
          NO TAKES YET. HIT REC, PERFORM, STOP — the file downloads instantly, upload-ready at 1080×1920.
        </div>
      )}
      <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: 190 }}>
        {takes.map((t) => (
          <div key={t.id}>
            <div className="cw-chip" style={{ cursor: 'default' }} data-testid={`take-${t.id}`}>
              <button
                className="flex-1 truncate text-left bg-transparent border-0 cursor-pointer mono p-0"
                style={{ fontSize: 10, color: previewId === t.id ? 'var(--cw-red)' : 'inherit' }}
                data-testid={`take-preview-toggle-${t.id}`}
                aria-expanded={previewId === t.id}
                onClick={() => setPreviewId((p) => (p === t.id ? null : t.id))}
              >
                {previewId === t.id ? '▾ ' : '▸ '}{t.name}
              </button>
              {/* POST-TAKE REPORT CARD verdict (RETENTION_FIX_PLAN Phase 6) —
                  a flagged take is never silently downloaded; the chip says so
                  at a glance and the expanded view shows the failing rows */}
              {t.report && (
                <span className="mono" data-testid={`take-report-chip-${t.id}`}
                  style={{
                    fontSize: 9, padding: '1px 5px',
                    border: `1px solid ${t.report.pass ? 'var(--cw-green)' : 'var(--cw-red)'}`,
                    color: t.report.pass ? 'var(--cw-green)' : 'var(--cw-red)',
                  }}>
                  {t.report.pass ? 'PASS' : 'FLAGGED'}
                </span>
              )}
              <small>{fmtDur(t.duration)} · {fmtSize(t.size)}</small>
              <a href={t.url} download={`${t.name}.${t.ext || 'webm'}`} className="mono"
                style={{ color: 'var(--cw-green)', fontSize: 10, textDecoration: 'none' }}
                data-testid={`take-download-${t.id}`}>▼ SAVE</a>
              <button onClick={() => { if (previewId === t.id) setPreviewId(null); onDelete(t.id); }}
                className="bg-transparent border-0 cursor-pointer mono"
                style={{ color: 'var(--cw-muted)', fontSize: 10 }} data-testid={`take-delete-${t.id}`}>✕</button>
            </div>
            {previewId === t.id && (
              <div className="mt-1 flex flex-col items-center gap-1" data-testid={`take-preview-${t.id}`}>
                {/* the blob url the recorder produced — 9:16, capped so the rail doesn't blow up */}
                <video
                  src={t.url}
                  controls
                  playsInline
                  className="w-full"
                  style={{ aspectRatio: '9 / 16', maxHeight: 300, background: '#000', border: '1px solid var(--cw-border)' }}
                >
                  <track kind="captions" />
                </video>
                {/* one-glance pass/fail rows (RETENTION_FIX_PLAN Phase 6 item 2):
                    recorder telemetry + loudness verification + director counters */}
                {t.report && t.report.rows && (
                  <div className="w-full mono flex flex-col gap-0.5" style={{ fontSize: 9 }}
                    data-testid={`take-report-${t.id}`} aria-label="Take report card">
                    {t.report.rows.map((r) => (
                      <div key={r.label} className="flex items-center justify-between gap-2 px-1.5 py-0.5"
                        style={{
                          background: r.ok ? 'rgba(255,255,255,0.03)' : 'rgba(255,26,46,0.08)',
                          border: `1px solid ${r.ok ? 'var(--cw-border)' : 'var(--cw-red)'}`,
                        }}>
                        <span style={{ color: 'var(--cw-muted)' }}>
                          {r.ok ? '✓' : '✕'} {r.label}{r.critical && !r.ok ? ' — CRITICAL' : ''}
                        </span>
                        <span style={{ color: r.ok ? 'var(--cw-text-2)' : 'var(--cw-red)' }}>{r.value}</span>
                      </div>
                    ))}
                    {!t.report.pass && (
                      <span className="text-center mt-0.5" style={{ color: 'var(--cw-red)' }}>
                        FLAGGED — AUTO-DOWNLOAD SKIPPED · ▼ SAVE IS THE EXPLICIT OVERRIDE
                      </span>
                    )}
                  </div>
                )}
                <button className="bg-transparent border-0 cursor-pointer mono text-[9px]"
                  style={{ color: 'var(--cw-muted)' }}
                  data-testid={`take-preview-close-${t.id}`}
                  onClick={() => setPreviewId(null)}>✕ CLOSE PREVIEW</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

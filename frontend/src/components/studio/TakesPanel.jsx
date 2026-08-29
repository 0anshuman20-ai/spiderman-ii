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

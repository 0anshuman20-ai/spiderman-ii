const fmtSize = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const TakesPanel = ({ takes, onDelete }) => (
  <div className="cw-panel" data-testid="takes-panel">
    <h2>◉ Takes — This Session ({takes.length})</h2>
    {takes.length === 0 && (
      <div className="mono text-[10px]" style={{ color: 'var(--cw-muted)' }}>
        NO TAKES YET. HIT REC, PERFORM, STOP — the file downloads instantly, upload-ready at 1080×1920.
      </div>
    )}
    <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: 190 }}>
      {takes.map((t) => (
        <div key={t.id} className="cw-chip" style={{ cursor: 'default' }} data-testid={`take-${t.id}`}>
          <span className="flex-1 truncate" style={{ fontSize: 10 }}>{t.name}</span>
          <small>{fmtDur(t.duration)} · {fmtSize(t.size)}</small>
          <a href={t.url} download={`${t.name}.${t.ext || 'webm'}`} className="mono"
            style={{ color: 'var(--cw-green)', fontSize: 10, textDecoration: 'none' }}
            data-testid={`take-download-${t.id}`}>▼ SAVE</a>
          <button onClick={() => onDelete(t.id)} className="bg-transparent border-0 cursor-pointer mono"
            style={{ color: 'var(--cw-muted)', fontSize: 10 }} data-testid={`take-delete-${t.id}`}>✕</button>
        </div>
      ))}
    </div>
  </div>
);

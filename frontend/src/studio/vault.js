/* THE VAULT — local, permanent, private storage for the Omega Layer.

   Two stores:
     performances : `.veyl` Performance Files (rig timelines — the take as DATA)
     episodes     : `.veylep` shot lists (an ordered cut assembled from many sources)

   IndexedDB, not localStorage: a performance is binary (hundreds of KB per minute),
   and it must survive reloads without ever leaving the machine. Nothing here is
   uploaded, ever. If IndexedDB is unavailable the Vault degrades to an in-memory
   map so the Omega Room still runs for the session. */

const DB_NAME = 'veyl-vault';
const DB_VERSION = 1;
const STORES = ['performances', 'episodes'];

let dbPromise = null;
const memory = { performances: new Map(), episodes: new Map() };
let memoryOnly = false;

function openDb() {
  if (memoryOnly) return Promise.reject(new Error('memory-only'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (err) { reject(err); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      STORES.forEach((s) => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => { memoryOnly = true; throw err; });
  return dbPromise;
}

function tx(store, mode, run) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = run(t.objectStore(store));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/* Typed arrays survive structured clone, so a Performance File goes into IDB as-is —
   no base64, no JSON bloat, no copy. Export to disk is a separate, explicit act. */
export const vault = {
  async put(store, record) {
    memory[store].set(record.id, record);
    try { await tx(store, 'readwrite', (os) => os.put(record)); } catch (_) { /* memory fallback */ }
    return record;
  },

  async get(store, id) {
    try {
      const rec = await tx(store, 'readonly', (os) => os.get(id));
      if (rec) return rec;
    } catch (_) { /* memory fallback */ }
    return memory[store].get(id) || null;
  },

  async all(store) {
    try {
      const list = await tx(store, 'readonly', (os) => os.getAll());
      if (list) {
        list.forEach((r) => memory[store].set(r.id, r));
        return list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      }
    } catch (_) { /* memory fallback */ }
    return [...memory[store].values()].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  },

  async remove(store, id) {
    memory[store].delete(id);
    try { await tx(store, 'readwrite', (os) => os.delete(id)); } catch (_) { /* memory fallback */ }
  },

  /* rough footprint so the UI can be honest about disk use */
  async usage() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const { usage, quota } = await navigator.storage.estimate();
        return { usage: usage || 0, quota: quota || 0 };
      }
    } catch (_) { /* not supported */ }
    return { usage: 0, quota: 0 };
  },

  get isMemoryOnly() { return memoryOnly; },
};

export const PERFORMANCES = 'performances';
export const EPISODES = 'episodes';

/* ------------------------------------------------------------------ */
/* `.veyl` ON DISK — the Performance File as a portable artifact.

   Layout:  "VEYL1" magic (5 ASCII bytes)
          + uint32 LE JSON byte length
          + JSON meta (name, world, duration, channel list, frame count, …)
          + the raw Float32Array channel buffers appended back-to-back (no base64)

   The channel list in the meta is canonical: import walks it in order and
   validates the magic AND every channel length before a byte is trusted.     */

const VEYL_MAGIC = 'VEYL1';
const VEYL_CHANNELS = ['joints', 'vis', 'face'];

/** Performance record -> downloadable Blob */
export function exportPerf(record) {
  const channels = VEYL_CHANNELS.map((key) => ({ key, length: record[key] ? record[key].length : 0 }));
  const meta = {
    v: 1,
    name: record.name,
    world: record.world,
    source: record.source || 'performed',
    seed: record.seed || 1,
    createdAt: record.createdAt,
    fps: record.fps,
    frames: record.frames,
    duration: record.duration,
    direction: record.direction || [],
    calib: record.calib || null,
    channels,
  };
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  const head = new ArrayBuffer(VEYL_MAGIC.length + 4);
  const headBytes = new Uint8Array(head);
  for (let i = 0; i < VEYL_MAGIC.length; i++) headBytes[i] = VEYL_MAGIC.charCodeAt(i);
  new DataView(head).setUint32(VEYL_MAGIC.length, metaBytes.length, true);
  const parts = [head, metaBytes];
  channels.forEach(({ key }) => { if (record[key]) parts.push(record[key].buffer.slice(record[key].byteOffset, record[key].byteOffset + record[key].byteLength)); });
  return new Blob(parts, { type: 'application/octet-stream' });
}

/** File/Blob -> Performance record (fresh id NOT assigned here — caller owns identity) */
export async function importPerf(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const magicLen = VEYL_MAGIC.length;
  if (bytes.length < magicLen + 4) throw new Error('not a .veyl file (truncated header)');
  let magic = '';
  for (let i = 0; i < magicLen; i++) magic += String.fromCharCode(bytes[i]);
  if (magic !== VEYL_MAGIC) throw new Error('not a .veyl file (bad magic)');
  const metaLen = new DataView(buf).getUint32(magicLen, true);
  const metaStart = magicLen + 4;
  if (bytes.length < metaStart + metaLen) throw new Error('corrupt .veyl (meta truncated)');
  let meta;
  try { meta = JSON.parse(new TextDecoder().decode(bytes.subarray(metaStart, metaStart + metaLen))); }
  catch (_) { throw new Error('corrupt .veyl (unreadable meta)'); }
  if (!Array.isArray(meta.channels) || !meta.frames) throw new Error('corrupt .veyl (missing channels)');

  const record = {
    magic: 'VEYL', v: meta.v || 1,
    id: `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    name: meta.name || 'imported-take',
    world: meta.world || 'nebula-drift',
    source: meta.source || 'performed',
    seed: meta.seed || 1,
    createdAt: meta.createdAt || new Date().toISOString(),
    fps: meta.fps || 30,
    frames: meta.frames,
    duration: meta.duration || meta.frames / (meta.fps || 30),
    direction: Array.isArray(meta.direction) ? meta.direction : [],
    calib: meta.calib || { height: 1.78, shoulder: 0.39 },
  };

  let offset = metaStart + metaLen;
  for (const ch of meta.channels) {
    if (!VEYL_CHANNELS.includes(ch.key)) throw new Error(`corrupt .veyl (unknown channel ${ch.key})`);
    const byteLen = ch.length * 4;
    if (offset + byteLen > bytes.length) throw new Error(`corrupt .veyl (${ch.key} channel truncated)`);
    // copy into an aligned buffer — the blob offset is not guaranteed 4-byte aligned
    const chBytes = bytes.slice(offset, offset + byteLen);
    record[ch.key] = new Float32Array(chBytes.buffer, 0, ch.length);
    offset += byteLen;
  }
  // channel lengths must agree with the frame count (33 joints x3, 33 vis, 10 face)
  if (record.joints.length !== record.frames * 99 || record.vis.length !== record.frames * 33 || record.face.length !== record.frames * 10) {
    throw new Error('corrupt .veyl (channel lengths disagree with frame count)');
  }
  return record;
}

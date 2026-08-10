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

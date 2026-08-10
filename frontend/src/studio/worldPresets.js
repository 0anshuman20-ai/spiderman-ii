/* WORLD EDITOR persistence — palette / density / motion presets per world.

   Two localStorage keys:
     veyl-world-presets : { [worldKey]: [{ name, params }] }  — named, saved presets
     veyl-world-active  : { [worldKey]: params }              — what is dialed in NOW

   The active map is what the Omega Stage reads so episodes honor whatever the
   live studio has dialed in. Everything degrades to defaults when storage is
   unavailable — the editor is an overlay, never a dependency. */

import { DEFAULT_WORLD_PARAMS } from './worlds';

const PRESETS_KEY = 'veyl-world-presets';
const ACTIVE_KEY = 'veyl-world-active';

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch (_) { return {}; }
}

function write(key, obj) {
  try { localStorage.setItem(key, JSON.stringify(obj)); } catch (_) { /* storage unavailable */ }
}

function clean(params) {
  const p = { ...DEFAULT_WORLD_PARAMS, ...(params || {}) };
  return {
    hueShift: Math.max(-180, Math.min(180, Number(p.hueShift) || 0)),
    density: Math.max(0.4, Math.min(1.6, Number(p.density) || 1)),
    motion: Math.max(0.2, Math.min(2.5, Number(p.motion) || 1)),
  };
}

export function isDefaultParams(params) {
  const p = clean(params);
  return p.hueShift === 0 && p.density === 1 && p.motion === 1;
}

/** the params currently dialed in for a world (null when stock) */
export function readActiveParams(worldKey) {
  const map = read(ACTIVE_KEY);
  const p = map[worldKey];
  return p && !isDefaultParams(p) ? clean(p) : null;
}

/** every world's active params — the lookup episodes render with */
export function readAllActiveParams() {
  const map = read(ACTIVE_KEY);
  const out = {};
  Object.keys(map).forEach((k) => {
    if (map[k] && !isDefaultParams(map[k])) out[k] = clean(map[k]);
  });
  return out;
}

export function writeActiveParams(worldKey, params) {
  const map = read(ACTIVE_KEY);
  if (!params || isDefaultParams(params)) delete map[worldKey];
  else map[worldKey] = clean(params);
  write(ACTIVE_KEY, map);
}

export function readPresets(worldKey) {
  const map = read(PRESETS_KEY);
  return Array.isArray(map[worldKey]) ? map[worldKey] : [];
}

export function savePreset(worldKey, name, params) {
  const map = read(PRESETS_KEY);
  const list = Array.isArray(map[worldKey]) ? map[worldKey] : [];
  const next = list.filter((p) => p.name !== name);
  next.push({ name, params: clean(params) });
  map[worldKey] = next.slice(-8); // keep the shelf short
  write(PRESETS_KEY, map);
  return map[worldKey];
}

export function deletePreset(worldKey, name) {
  const map = read(PRESETS_KEY);
  map[worldKey] = (map[worldKey] || []).filter((p) => p.name !== name);
  write(PRESETS_KEY, map);
  return map[worldKey];
}

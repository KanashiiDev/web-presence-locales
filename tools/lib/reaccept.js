/**
 * Controlled metadata re-acceptance for translations whose English source was
 * edited after acceptance. Target files are never modified: only the recorded
 * sourceHash moves to the current English value for keys that already had an
 * accepted entry.
 */
import { teHashSource } from './hash.js';

export function planReaccept({ source, target, meta, keys = null, includeUnverified = false }) {
  const planned = [];
  const acceptedKeys = meta?.keys || {};
  const keyFilter = keys ? new Set(keys) : null;

  for (const key of Object.keys(source).sort()) {
    const previous = acceptedKeys[key]?.sourceHash;
    const verified = typeof previous === 'string';
    if (!verified && !includeUnverified) continue;
    if (!(key in target) || typeof target[key] !== 'string' || !target[key]) continue;
    if (keyFilter && !keyFilter.has(key)) continue;
    // An English seed is not a translation; never accept it as one.
    if (!verified && target[key] === source[key]) continue;
    const next = teHashSource(source[key], key);
    if (verified && previous === next) continue;
    planned.push({ key, previous: verified ? previous : null, next, unverified: !verified });
  }

  return planned;
}

export function applyReaccept({ meta, plan }) {
  if (!plan.length) return meta;
  const keys = { ...(meta.keys || {}) };
  for (const entry of plan) {
    keys[entry.key] = { ...(keys[entry.key] || {}), sourceHash: entry.next };
  }
  return { ...meta, keys };
}

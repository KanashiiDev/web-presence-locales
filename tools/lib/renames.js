/**
 * Safe key rename detection.
 *
 * A translation may only be carried to a new key when the English value did
 * not change. A changed value is a different source string: the old translation
 * is left untouched and orphan cleanup removes the old key. Hash comparison is
 * not usable here because teHashSource() includes the key in its input.
 */
import { sortedKeys } from './util.js';
import { NAMESPACES } from './constants.js';

/**
 * Compare the previous source mirror with the incoming upstream source.
 * Only one-to-one matches with an identical value are safe renames. A removed
 * key with several matching added keys is skipped: doing nothing is safer than
 * guessing which translation to carry.
 */
export function detectSafeRenames(previous = {}, next = {}, namespaces = NAMESPACES) {
  const detected = Object.create(null);
  for (const ns of namespaces) {
    const before = previous[ns] || {};
    const after = next[ns] || {};
    const removed = sortedKeys(before).filter((key) => !(key in after));
    const added = sortedKeys(after).filter((key) => !(key in before));
    if (!removed.length || !added.length) continue;

    const byValue = new Map();
    for (const key of added) {
      const value = after[key];
      if (typeof value !== 'string') continue;
      if (!byValue.has(value)) byValue.set(value, []);
      byValue.get(value).push(key);
    }

    const renames = Object.create(null);
    const used = new Set();
    for (const key of removed) {
      const candidates = (byValue.get(before[key]) || []).filter((candidate) => !used.has(candidate));
      if (candidates.length !== 1) continue;
      renames[key] = candidates[0];
      used.add(candidates[0]);
    }
    if (Object.keys(renames).length) detected[ns] = renames;
  }
  return detected;
}

/** Accumulate newly detected renames on top of the previously stored ones. */
export function mergeSafeRenames(existing, detected) {
  const result = Object.create(null);
  for (const ns of NAMESPACES) {
    const oldMap = existing?.[ns];
    const newMap = detected?.[ns];
    if (!oldMap && !newMap) continue;
    result[ns] = { ...(oldMap || {}), ...(newMap || {}) };
  }
  return result;
}

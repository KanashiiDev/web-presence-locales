/**
 * Publication coverage and sticky-publish rule, shared by the processor and
 * manifest generator.
 *
 * A key counts only when all three are true:
 *   - it exists in the English source,
 *   - the target file has a non-empty string for it,
 *   - metadata records an accepted sourceHash for it.
 * Outdated keys still count (their metadata entry exists); a seeded English
 * copy never does (it has no metadata entry).
 */
import { NAMESPACES, PUBLISH_THRESHOLD } from './constants.js';

export function computeCoverage({ source, targets = {}, metas = {} }) {
  let total = 0;
  let accepted = 0;
  for (const ns of NAMESPACES) {
    const nsSource = source?.[ns] || {};
    const target = targets[ns] || {};
    const metaKeys = metas[ns]?.keys || {};
    for (const key of Object.keys(nsSource)) {
      total += 1;
      const value = target[key];
      if (typeof value === 'string' && value.trim() !== '' && typeof metaKeys[key]?.sourceHash === 'string') {
        accepted += 1;
      }
    }
  }
  return { total, accepted, coverage: total > 0 ? accepted / total : 0 };
}

/** Resolve publication from coverage, the previous state and an optional override. */
export function resolvePublished({ coverage, previousPublished = false, override }) {
  if (override === false) return false;
  return coverage >= PUBLISH_THRESHOLD || previousPublished === true;
}

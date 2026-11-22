/**
 * Key-level patch application with three-way comparison.
 *
 * Complete translation files are never replaced. A patch is applied on top of
 * the current target file, copying all unrelated keys verbatim.
 *
 * Three-way rules (per key):
 *   current target matches baseTargetHash -> apply
 *   current target already equals submitted value -> skip (already applied)
 *   current target differs from both -> conflict
 *   current source hash != submitted sourceHash -> requires review (no apply)
 */
import { teHashTarget } from './hash.js';
import { deepClone, safeAssign, sortedKeys } from './util.js';
import { checkSubmissionSourceFreshness } from './freshness.js';

export function compareKey(currentValue, change, key) {
  const currentTargetHash = teHashTarget(currentValue, key);
  if (currentTargetHash === change.baseTargetHash) return { action: 'apply', currentTargetHash };
  if (currentValue === change.value) return { action: 'already-applied', currentTargetHash };
  return { action: 'conflict', currentTargetHash };
}

/**
 * Apply a validated submission to the current target file and metadata inputs.
 *
 * @returns {{
 *   status: 'applied'|'already-applied'|'conflict'|'partial-conflict'|'needs-review'|'partial-needs-review',
 *   newTarget: object,
 *   acceptedKeys: string[],
 *   staleKeys: string[],
 *   conflictKeys: string[],
 *   results: object,
 *   sourceFreshness: object
 * }}
 */
export function applySubmission({ submission, currentTarget, source, sourceFreshness }) {
  const freshness = sourceFreshness || checkSubmissionSourceFreshness({ submission, source });
  const nsSource = source[submission.ns] || {};
  const newTarget = deepClone(currentTarget);
  const results = Object.create(null);
  const acceptedKeys = [];
  let conflicts = 0;
  let applied = 0;
  let already = 0;

  for (const key of sortedKeys(submission.changes)) {
    const change = submission.changes[key];

    if (freshness.keys[key] !== 'fresh') {
      results[key] = { action: 'requires-review', reason: freshness.keys[key] };
      continue;
    }

    const currentValue = key in currentTarget ? currentTarget[key] : '';
    const comparison = compareKey(currentValue, change, key);
    results[key] = comparison;

    if (comparison.action === 'apply') {
      safeAssign(newTarget, key, change.value);
      acceptedKeys.push(key);
      applied += 1;
    } else if (comparison.action === 'already-applied') {
      already += 1;
    } else {
      conflicts += 1;
    }
  }

  const staleKeys = Object.keys(results).filter((k) => results[k].action === 'requires-review');
  const conflictKeys = Object.keys(results).filter((k) => results[k].action === 'conflict');

  let status;
  if (conflicts && applied) status = 'partial-conflict';
  else if (conflicts) status = 'conflict';
  else if (staleKeys.length && applied) status = 'partial-needs-review';
  else if (staleKeys.length) status = 'needs-review';
  else if (applied === 0 && already > 0) status = 'already-applied';
  else status = 'applied';

  const finalTarget = status === 'needs-review' ? deepClone(currentTarget) : newTarget;
  const finalAccepted = status === 'needs-review' ? [] : acceptedKeys;

  return {
    status,
    newTarget: finalTarget,
    acceptedKeys: finalAccepted,
    staleKeys,
    conflictKeys,
    results,
    sourceFreshness: freshness,
    counts: { applied, alreadyApplied: already, conflicts, requiresReview: staleKeys.length },
  };
}

/** Translation freshness validation, always computed from current state. */
import { VALIDATOR_VERSION, HASH_VERSION } from './constants.js';
import { namespaceBlobSha, teHashSource, teHashTarget } from './hash.js';
import { sortedKeys } from './util.js';

/** Compute freshness from in-memory source/target/meta for one namespace. */
export function evaluateNamespaceFreshness({ source, target, meta }) {
  const sourceKeys = sortedKeys(source);
  const targetKeys = sortedKeys(target);
  const missingKeys = sourceKeys.filter((key) => !(key in target));
  const extraKeys = targetKeys.filter((key) => !(key in source));
  const keyStatus = Object.create(null);
  const outdatedKeys = [];
  const unverifiedKeys = [];

  for (const key of sourceKeys) {
    if (!(key in target)) continue;
    const currentSourceHash = teHashSource(source[key], key);
    const accepted = meta?.keys?.[key]?.sourceHash;
    let status;
    if (accepted === undefined) {
      status = 'unverified';
      unverifiedKeys.push(key);
    } else if (accepted !== currentSourceHash) {
      status = 'outdated';
      outdatedKeys.push(key);
    } else {
      status = 'up-to-date';
    }
    keyStatus[key] = status;
  }

  const total = sourceKeys.length;
  const translated = sourceKeys.filter((key) => key in target && meta?.keys?.[key] !== undefined).length;
  const isUpToDate = total > 0
    && missingKeys.length === 0
    && extraKeys.length === 0
    && outdatedKeys.length === 0
    && unverifiedKeys.length === 0;

  return {
    isUpToDate,
    total,
    translated,
    missingKeys,
    extraKeys,
    outdatedKeys,
    unverifiedKeys,
    keyStatus,
  };
}

/** Called when a language/namespace is opened in the editor. */
export async function checkLanguageOpen({ source, target, meta, ns }) {
  const nsMeta = meta?.namespaces?.[ns];
  return {
    validatorVersion: VALIDATOR_VERSION,
    hashVersion: HASH_VERSION,
    enBlobSha: namespaceBlobSha(source),
    targetBlobSha: namespaceBlobSha(target),
    ns,
    ...evaluateNamespaceFreshness({ source, target, meta: nsMeta }),
  };
}

/**
 * Editor-side draft comparison. Detects source/target changes made after the
 * draft was created and whether the draft was already applied.
 */
export function compareDraft({ draft, source, target }) {
  const results = Object.create(null);
  let changed = false;

  for (const [key, change] of Object.entries(draft?.changes || {})) {
    const currentSource = key in source ? teHashSource(source[key], key) : null;
    const currentTargetHash = key in target ? teHashTarget(target[key], key) : null;
    const statuses = [];

    if (currentSource === null || currentSource !== change.sourceHash) statuses.push('source-changed');
    if (currentTargetHash === null || currentTargetHash !== change.baseTargetHash) statuses.push('target-changed');
    if (key in target && target[key] === change.value) statuses.push('draft-applied');

    const status = statuses.length ? statuses.join('+') : 'ok';
    results[key] = { status, currentSourceHash: currentSource, currentTargetHash };
    if (status !== 'ok') changed = true;
  }

  return { changed, keys: results };
}

/**
 * Authoritative source freshness check for a submission. A mismatch means the
 * contributor translated against a different English source and the change
 * must be reviewed rather than silently accepted.
 */
export function checkSubmissionSourceFreshness({ submission, source }) {
  const nsSource = source[submission.ns];
  const results = Object.create(null);
  let requiresReview = false;

  for (const [key, change] of Object.entries(submission.changes)) {
    if (!nsSource || !(key in nsSource)) {
      results[key] = 'source-key-missing';
      requiresReview = true;
      continue;
    }
    const current = teHashSource(nsSource[key], key);
    if (current !== change.sourceHash) {
      results[key] = 'outdated';
      requiresReview = true;
    } else {
      results[key] = 'fresh';
    }
  }

  return { requiresReview, keys: results };
}

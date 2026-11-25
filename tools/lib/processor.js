/**
 * Submission processor: the authoritative pipeline used by GitHub Actions.
 *
 * 1. load payload          2. validate schema
 * 3. latest repo state     4. source freshness
 * 5. target freshness      6. three-way conflict detection
 * 7. QA (scoped to the patch) 8. safe patch application
 * 9. metadata update       10. atomic commit + auto-merge
 *
 * Every run consumes exactly one submission: the original file is deleted in
 * the same atomic commit that applies the safe keys. The outcome is delivered
 * as a PR comment, so no result/archive files accumulate and re-runs are
 * naturally idempotent (the queue entry no longer exists).
 */
import {
  NAMESPACES, LOCALES_DIR, LANGUAGES_FILE, LANG_LABELS,
  SUBMISSIONS_DIR, META_FILE, LANG_RE, LANG_ALLOWLIST,
} from './constants.js';
import { validateSubmission, validatePayloadSize } from './submission.js';
import { checkSubmissionSourceFreshness } from './freshness.js';
import { applySubmission } from './patch.js';
import {
  updateMetaForPatch, serializeMeta, bootstrapNamespace, bootstrapMeta, emptyMeta, ensureHashVersion,
} from './metadata.js';
import { validateTranslation, completionGaps, validateJsonShape } from './validation.js';
import { teValidateKey } from './qa.js';
import { computeCoverage, resolvePublished } from './coverage.js';
import { serializeTranslations, nowIso } from './util.js';
import { HeadChangedError } from './adapters.js';

function targetPath(lang, ns) {
  return `${LOCALES_DIR}/${lang}/${ns}.json`;
}
function metaPath(lang) {
  return `${LOCALES_DIR}/${lang}/${META_FILE}`;
}
function submissionRel(lang, id) {
  return `${SUBMISSIONS_DIR}/${lang}/${id}.json`;
}

/** Only a genuine "not found" means the file is absent; everything else throws. */
function isNotFound(err) {
  return err?.status === 404 || err?.code === 'ENOENT' || /not found/i.test(err?.message || '');
}

/** Deterministic serialization of locales/languages.json (sorted language codes). */
function serializeLanguages(langs) {
  const ordered = Object.fromEntries(Object.keys(langs).sort().map((code) => [code, langs[code]]));
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

async function buildOutcome({ adapter, langs, sourceState, lang, id, expectedHead }) {
  let rawText;
  try {
    rawText = await adapter.readSubmissionText(lang, id, expectedHead);
  } catch (err) {
    if (isNotFound(err)) {
      return { id, lang, status: 'skipped', reason: 'submission-no-longer-present', commit: null };
    }
    throw err;
  }

  const sizeCheck = validatePayloadSize(rawText);
  if (!sizeCheck.ok) {
    return rejectSubmission({ id, lang, payload: rawText, reason: 'invalid-payload', errors: sizeCheck.errors });
  }

  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    return rejectSubmission({
      id, lang, payload: rawText, reason: 'invalid-json', errors: ['Submission is not valid JSON'],
    });
  }

  const validation = validateSubmission(payload, { langs, namespaces: NAMESPACES });
  if (!validation.ok) {
    return rejectSubmission({ id, lang, payload, reason: 'invalid-payload', errors: validation.errors });
  }

  const submission = validation.value;
  if (submission.lang !== lang || submission.id !== id) {
    return rejectSubmission({
      id, lang, payload, submission, reason: 'path-mismatch',
      errors: [`Payload lang/id (${submission.lang}/${submission.id}) do not match intake path (${lang}/${id})`],
    });
  }

  const ns = submission.ns;
  const nsSource = sourceState.source[ns];
  if (!nsSource) {
    return rejectSubmission({ id, lang, payload, submission, reason: 'unknown-namespace' });
  }

  const isNewLanguage = !Object.prototype.hasOwnProperty.call(langs, lang);
  if (isNewLanguage && LANG_ALLOWLIST.size > 0 && !LANG_ALLOWLIST.has(lang)) {
    return rejectSubmission({
      id, lang, payload, submission, reason: 'language-not-allowed',
      errors: [`Language ${lang} is not in LANG_ALLOWLIST`],
    });
  }

  let currentTarget;
  try {
    currentTarget = await adapter.readTarget(lang, ns, expectedHead);
  } catch (err) {
    if (isNotFound(err)) currentTarget = null;
    else throw err;
  }
  const isNewTarget = currentTarget === null;
  if (isNewTarget) currentTarget = { ...nsSource };
  // A malformed target file must be rejected, not copied verbatim into the
  // next commit. The patch only QA-checks accepted keys, so unrelated bad
  // values would otherwise survive into the published translation file.
  const shapeIssues = validateJsonShape(currentTarget, `${lang}/${ns}`);
  if (shapeIssues.length) {
    return rejectSubmission({
      id, lang, payload, submission, reason: 'invalid-target-file',
      errors: shapeIssues.map((entry) => `${entry.key || '(root)'}: ${entry.message}`),
    });
  }

  let currentMeta = await adapter.readMeta(lang, expectedHead);
  const migrated = ensureHashVersion(currentMeta, sourceState.source);
  currentMeta = migrated.meta;

  const sourceFreshness = checkSubmissionSourceFreshness({ submission, source: { [ns]: nsSource } });
  const patchResult = applySubmission({ submission, currentTarget, source: { [ns]: nsSource }, sourceFreshness, isNewTarget });

  const accepted = [...patchResult.acceptedKeys];
  const newTarget = { ...patchResult.newTarget };
  const qaDroppedKeys = [];
  const qaWarnings = [];
  for (const key of [...patchResult.acceptedKeys]) {
    const verdict = teValidateKey({ key, source: nsSource[key], value: patchResult.newTarget[key] });
    const errorCodes = verdict.errors.map((entry) => entry.code);
    const isEmpty = verdict.warnings.some((entry) => entry.code === 'empty-value');
    if (!errorCodes.length && !isEmpty) {
      qaWarnings.push(...verdict.warnings.map((entry) => ({ key, code: entry.code, message: entry.message })));
      continue;
    }
    if (key in currentTarget) newTarget[key] = currentTarget[key];
    else delete newTarget[key];
    accepted.splice(accepted.indexOf(key), 1);
    if (errorCodes.length) qaDroppedKeys.push({ key, codes: errorCodes });
    else qaWarnings.push({ key, code: 'empty-value', message: 'Empty value was not written' });
  }
  const qaStatus = qaDroppedKeys.length && !['needs-review', 'conflict', 'partial-conflict', 'partial-needs-review'].includes(patchResult.status)
    ? 'partial'
    : patchResult.status;

  const result = {
    id,
    lang,
    ns,
    baseCommit: submission.baseCommit,
    status: qaStatus,
    reason: patchResult.status === 'needs-review' ? 'source-hash-mismatch' : null,
    sourceFreshness: patchResult.sourceFreshness.keys,
    appliedKeys: accepted,
    qaDroppedKeys,
    qaWarnings,
    staleKeys: patchResult.staleKeys,
    conflictKeys: patchResult.conflictKeys,
    reviewRequired: patchResult.staleKeys.length > 0 || patchResult.conflictKeys.length > 0 || qaDroppedKeys.length > 0,
    results: patchResult.results,
    counts: patchResult.counts,
    isNewLanguage,
    metaMigrated: migrated.migrated,
    timestamp: nowIso(),
  };

  // Every outcome is handled the same way: safe keys are already applied to
  // `newTarget`, skipped keys are listed in the result, and the immutable
  // result + archive documents are the only feedback channel. There is no
  // separate review queue to own or resolve.

  const seededTargets = {};
  for (const seedNs of NAMESPACES) seededTargets[seedNs] = sourceState.source[seedNs] || {};
  seededTargets[ns] = newTarget;

  const metaBase = !currentMeta && isNewTarget
    ? bootstrapMeta(lang, sourceState.source, seededTargets, {
      commit: sourceState.commit, blobs: sourceState.blobs || {}, acceptAll: false,
    })
    : (!currentMeta?.namespaces?.[ns]
      ? bootstrapNamespace(currentMeta || emptyMeta(lang), lang, ns, nsSource, currentTarget, { acceptAll: false })
      : currentMeta);

  const newMeta = updateMetaForPatch({
    meta: metaBase,
    lang,
    ns,
    source: nsSource,
    newTarget,
    acceptedKeys: accepted,
    commit: sourceState.commit,
    blobs: sourceState.blobs ? { [ns]: sourceState.blobs[ns] } : {},
  });

  const fileQa = validateTranslation({ source: nsSource, target: newTarget, keyScope: accepted });
  qaWarnings.push(...fileQa.map((entry) => ({ key: entry.key, code: entry.code, message: entry.message })));

  const gaps = completionGaps(nsSource, newTarget);
  const completionWarnings = [];
  if (gaps.missingKeys.length) completionWarnings.push(`${gaps.missingKeys.length} key(s) not yet translated`);
  if (gaps.extraKeys.length) completionWarnings.push(`${gaps.extraKeys.length} orphan key(s) not in the English source`);

  // A brand-new language with zero accepted keys must not be bootstrapped from
  // the English source: that would publish an English file that looks like a
  // finished translation. Consume the submission and report the result, but
  // leave the language unbootstrapped until a submission actually applies.
  const skipSeed = isNewTarget && accepted.length === 0;
  const files = [];
  const deletions = [submissionRel(lang, id)];
  if (isNewTarget && !skipSeed) {
    // Only write files that are genuinely absent. A language can exist with
    // translated files in some namespaces while one namespace is missing;
    // seeding all namespaces from English would silently destroy those
    // translations. For a brand-new language every file is absent, so all
    // required files are still created.
    for (const seedNs of NAMESPACES) {
      let content;
      if (seedNs === ns) {
        content = serializeTranslations(newTarget, Object.keys(nsSource));
      } else {
        let existing = null;
        try {
          existing = await adapter.readTarget(lang, seedNs, expectedHead);
        } catch (err) {
          // An unreadable file may still contain translations: never overwrite.
          if (!isNotFound(err)) continue;
        }
        if (existing !== null) continue;
        const sourceNs = sourceState.source[seedNs] || {};
        content = serializeTranslations(sourceNs, Object.keys(sourceNs));
      }
      files.push({ path: targetPath(lang, seedNs), content });
    }
  } else {
    const currentTargetText = serializeTranslations(currentTarget, Object.keys(nsSource));
    const newTargetText = serializeTranslations(newTarget, Object.keys(nsSource));
    if (newTargetText !== currentTargetText) {
      files.push({ path: targetPath(lang, ns), content: newTargetText });
    }
  }

  const coverage = computeCoverage({ source: sourceState.source, targets: seededTargets, metas: newMeta.namespaces });
  const previousEntry = langs[lang];
  const published = resolvePublished({
    coverage: coverage.coverage,
    previousPublished: previousEntry?.published === true,
    override: previousEntry?.published === false ? false : undefined,
  });
  if (!previousEntry && !skipSeed) {
    langs[lang] = { label: LANG_LABELS[lang] || lang, extension: true, server: true };
    files.push({ path: `${LOCALES_DIR}/${LANGUAGES_FILE}`, content: serializeLanguages(langs) });
  }

  const currentMetaText = currentMeta ? serializeMeta(currentMeta) : '';
  const newMetaText = serializeMeta(newMeta);
  if (newMetaText !== currentMetaText && !skipSeed) {
    files.push({ path: metaPath(lang), content: newMetaText });
  }

  const finalResult = {
    ...result,
    published,
    coverage: coverage.coverage,
    completion: gaps,
    qa: { warnings: [...qaWarnings.map((entry) => `${entry.key}: ${entry.code}`), ...completionWarnings] },
  };
  const commit = await finalize({ adapter, files, deletions, expectedHead, message: `[locale] ${qaStatus} ${lang}/${id}` });
  return { ...finalResult, commit: commit?.oid || null };
}

/** Typed result for a submission that was rejected instead of applied. */
class RejectedSubmission {
  constructor({ id, lang, payload, reason, errors, result }) {
    this.id = id;
    this.lang = lang;
    this.payload = payload;
    this.reason = reason;
    this.errors = errors;
    this.result = result;
  }
}

function rejectSubmission({ id, lang, payload, submission, result = {}, reason, errors = [] }) {
  return new RejectedSubmission({
    id, lang, payload, reason, errors,
    result: { ...result, id, lang, status: 'rejected', reason, errors, timestamp: nowIso() },
  });
}

/** Commit the applied files and consume the submission. Nothing else persists. */
async function finalize({ adapter, files = [], deletions = [], expectedHead, message }) {
  return adapter.commit({ files, deletions, expectedHead, message });
}

/** Process all pending submissions. */
export async function processSubmissions({ adapter, maxHeadRetries = 3 } = {}) {
  const sourceState = await adapter.readSource();
  const pending = await adapter.listPending();
  const summary = {
    validatorRun: nowIso(),
    sourceCommit: sourceState.commit,
    sourceProvider: sourceState.provider,
    pending: pending.length,
    processed: 0,
    skipped: 0,
    results: [],
  };

  for (const { lang, id } of pending) {
    if (!LANG_RE.test(lang) || lang !== lang.toLowerCase()) {
      summary.results.push({ id, lang, status: 'error', reason: 'invalid-submission-directory' });
      // Quarantine automatically: leaving the file in place makes every later
      // run fail forever and requires manual intervention to recover.
      try {
        const head = await adapter.getHead();
        await adapter.commit({
          files: [],
          deletions: [submissionRel(lang, id)],
          expectedHead: head,
          message: `[locale] cleanup invalid-submission-directory ${lang}/${id}`,
        });
      } catch {
        // Best effort: a malformed path may be rejected by the storage layer.
      }
      continue;
    }
    let done = false;
    for (let attempt = 0; attempt <= maxHeadRetries && !done; attempt += 1) {
      let expectedHead;
      try {
        expectedHead = await adapter.getHead();
        const langs = { ...(await adapter.readLanguages(expectedHead)) };
        let outcome = await buildOutcome({ adapter, langs, sourceState, lang, id, expectedHead });
        if (outcome instanceof RejectedSubmission) {
          const r = outcome;
          const commit = await finalize({
            adapter,
            deletions: [submissionRel(lang, id)],
            expectedHead,
            message: `[locale] rejected ${lang}/${id}`,
          });
          outcome = { ...r.result, commit: commit?.oid || null };
        }
        summary.results.push(outcome);
        summary.processed += 1;
        done = true;
      } catch (err) {
        if (err instanceof HeadChangedError && attempt < maxHeadRetries) continue;
        summary.results.push({
          id,
          lang,
          status: 'error',
          reason: err.name === 'HeadChangedError' ? 'head-changed-retry-exhausted' : 'processing-error',
          message: err.message,
          expectedHead,
        });
        done = true;
      }
    }
  }

  return summary;
}

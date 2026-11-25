/**
 * Translation QA. Existing project rules (flat key -> string JSON,
 * placeholder preservation) are extended with freshness and metadata consistency checks.
 */
import { SCHEMA_VERSION, HASH_VERSION, NAMESPACES, SHA1_RE, HASH_RE } from './constants.js';
import { isPlainObject, isUnsafeKey, sortedKeys } from './util.js';
import { teValidateKey } from './qa.js';

function issue(severity, code, key, message) {
  return { severity, code, key, message };
}

export function validateJsonShape(value, label) {
  const issues = [];
  if (!isPlainObject(value)) {
    issues.push(issue('error', 'not-object', null, `${label} must be a flat JSON object`));
    return issues;
  }
  for (const key of Object.keys(value)) {
    if (isUnsafeKey(key)) issues.push(issue('error', 'unsafe-key', key, `${label} contains an unsafe key`));
    if (typeof value[key] !== 'string') {
      issues.push(issue('error', 'non-string-value', key, `${label} values must be strings`));
    }
  }
  return issues;
}

/**
 * Validate a translated namespace against the English source.
 * @param {string[]|null} [options.keyScope] When provided, only these keys are checked.
 */
export function validateTranslation({ source, target, allowMissing = false, allowExtra = false, keyScope = null }) {
  const issues = validateJsonShape(target, 'translation');
  const scope = keyScope ? new Set(keyScope) : null;
  const sourceKeys = sortedKeys(source).filter((k) => !scope || scope.has(k));
  const targetKeys = sortedKeys(target).filter((k) => !scope || scope.has(k));

  for (const key of sourceKeys) {
    if (!(key in target)) {
      if (!allowMissing) issues.push(issue('warning', 'missing-key', key, 'Translation key is missing'));
      continue;
    }
    const result = teValidateKey({ key, source: source[key], value: target[key] });
    for (const entry of [...result.errors, ...result.warnings]) {
      issues.push(issue(entry.severity, entry.code, key, entry.message));
    }
  }

  if (!allowExtra) {
    for (const key of targetKeys) {
      if (!(key in source)) issues.push(issue('warning', 'extra-key', key, 'Orphaned key is not present in the English source'));
    }
  }

  return issues;
}

export function validateNamespaceSet({ langs, lang, availableNamespaces }) {
  const issues = [];
  const declared = NAMESPACES.filter((ns) => ns === 'shared' || langs[lang]?.[ns] === true);
  for (const ns of availableNamespaces) {
    if (!NAMESPACES.includes(ns)) issues.push(issue('error', 'unknown-namespace', ns, 'Unknown namespace'));
    if (!declared.includes(ns)) issues.push(issue('error', 'namespace-disabled', ns, `Namespace is not enabled for ${lang}`));
  }
  if (declared.some((ns) => !availableNamespaces.includes(ns))) {
    issues.push(issue('error', 'missing-namespace', null, 'A declared namespace has no translation file'));
  }
  return issues;
}

/** Validate a whole-language metadata document against the source namespaces. */
export function validateMeta({ meta, lang, sourceByNamespace }) {
  const issues = [];
  if (!isPlainObject(meta)) return [issue('error', 'meta-missing', null, 'Language metadata is missing')];
  if (meta.schemaVersion !== SCHEMA_VERSION) issues.push(issue('error', 'meta-version', null, 'Unsupported metadata schema version'));
  if (meta.hashVersion !== HASH_VERSION) issues.push(issue('error', 'meta-hash-version', null, `Metadata hashVersion must be ${HASH_VERSION}`));
  if (meta.lang !== lang) issues.push(issue('error', 'meta-lang', null, 'Metadata language does not match directory'));

  for (const ns of Object.keys(meta.namespaces || {})) {
    if (!NAMESPACES.includes(ns)) issues.push(issue('error', 'meta-namespace', ns, 'Unknown namespace in metadata'));
    if (meta.namespaces[ns].targetBlobSha && !SHA1_RE.test(meta.namespaces[ns].targetBlobSha)) {
      issues.push(issue('error', 'meta-blob-sha', ns, 'Invalid targetBlobSha'));
    }
    const nsSource = sourceByNamespace?.[ns] || {};
    for (const key of Object.keys(meta.namespaces[ns].keys || {})) {
      if (!(key in nsSource)) {
        issues.push(issue('warning', 'meta-orphan-key', `${ns}:${key}`, 'Metadata key is not in the source'));
      }
      if (!HASH_RE.test(meta.namespaces[ns].keys[key]?.sourceHash || '')) {
        issues.push(issue('error', 'meta-source-hash', `${ns}:${key}`, 'Invalid sourceHash'));
      }
    }
  }
  return issues;
}

/**
 * Complete QA run for one language namespace.
 * @param {string} [options.lang] The directory language.
 * @param {string[]|null} [options.keyScope] Restrict key-level checks to these keys.
 */
export function runQa({ source, target, meta, ns, lang, sourceByNamespace, keyScope = null }) {
  const translation = validateTranslation({ source, target, keyScope });
  const metadata = meta ? validateMeta({
    meta,
    lang: lang ?? meta.lang,
    sourceByNamespace: sourceByNamespace || (ns ? { [ns]: source } : {}),
  }) : [];
  const errors = [...translation, ...metadata].filter((i) => i.severity === 'error');
  const warnings = [...translation, ...metadata].filter((i) => i.severity === 'warning');
  return { ok: errors.length === 0, errors, warnings };
}

/** Missing and orphan keys in a namespace. */
export function completionGaps(source, target) {
  const missingKeys = sortedKeys(source).filter((k) => !(k in target));
  const extraKeys = sortedKeys(target).filter((k) => !(k in source));
  return { missingKeys, extraKeys };
}

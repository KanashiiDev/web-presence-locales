/**
 * Per-language metadata (locales/<lang>/.meta.json).
 *
 * The only per-key information stored is `sourceHash`: the hash of the English
 * source string against which the target value was last accepted. This is the
 * minimal data required to detect outdated translations without a draft.
 * Everything else (blob SHAs, progress, missing/extra keys) is derived from
 * repository state at read time.
 */
import { META_FILE, SCHEMA_VERSION, HASH_VERSION, NAMESPACES, SOURCE_REPO } from './constants.js';
import { localePath, readJsonIfExists, writeIfChanged } from './fsutil.js';
import { teHashSource, namespaceBlobSha, isSupportedHashVersion } from './hash.js';
import { deepClone, safeAssign, sortedKeys } from './util.js';

export function emptyMeta(lang) {
  return {
    schemaVersion: SCHEMA_VERSION,
    hashVersion: HASH_VERSION,
    lang,
    source: { repo: SOURCE_REPO, commit: null, blobs: {} },
    namespaces: {},
  };
}

/**
 * Upgrade a legacy metadata document to the current hash version.
 * @returns {{meta: object, migrated: boolean}}
 */
export function ensureHashVersion(meta, sourceByNamespace = {}) {
  if (!meta) return { meta, migrated: false };
  if (isSupportedHashVersion(meta.hashVersion) && meta.hashVersion === HASH_VERSION) {
    return { meta, migrated: false };
  }
  if (!isSupportedHashVersion(meta.hashVersion)) {
    throw new Error(`Unsupported metadata hashVersion: ${meta.hashVersion}`);
  }
  const next = deepClone(meta);
  next.hashVersion = HASH_VERSION;
  for (const [ns, data] of Object.entries(next.namespaces || {})) {
    const source = sourceByNamespace[ns] || {};
    for (const key of Object.keys(data.keys || {})) {
      if (key in source) safeAssign(data.keys, key, { sourceHash: teHashSource(source[key], key) });
    }
  }
  return { meta: next, migrated: true };
}

export async function readMeta(root, lang) {
  return readJsonIfExists(localePath(root, lang, META_FILE));
}

/** Deterministic serialization keeps metadata writes stable. */
export function serializeMeta(meta) {
  const ordered = {
    schemaVersion: meta.schemaVersion,
    hashVersion: meta.hashVersion ?? HASH_VERSION,
    lang: meta.lang,
    source: {
      repo: meta.source?.repo ?? SOURCE_REPO,
      commit: meta.source?.commit ?? null,
      blobs: orderKeys(meta.source?.blobs),
    },
    namespaces: orderKeys(meta.namespaces).map(([ns, data]) => [ns, {
      targetBlobSha: data.targetBlobSha ?? null,
      keys: orderKeys(data.keys).map(([key, value]) => [key, { sourceHash: value.sourceHash }]),
    }]),
  };
  // Convert the ordered arrays back into objects (arrays preserve insertion order).
  const toObject = (entries) => Object.fromEntries(entries);
  ordered.source.blobs = toObject(ordered.source.blobs);
  ordered.namespaces = Object.fromEntries(
    ordered.namespaces.map(([ns, data]) => [ns, { ...data, keys: toObject(data.keys) }]),
  );
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

function orderKeys(obj) {
  return sortedKeys(obj || {}).map((k) => [k, obj[k]]);
}

export async function writeMeta(root, lang, meta) {
  const file = localePath(root, lang, META_FILE);
  return writeIfChanged(file, serializeMeta(meta));
}

/** Create a baseline metadata record from current source + target files. */
export function bootstrapMeta(lang, source, targets, { commit = null, blobs = {}, acceptAll = true } = {}) {
  const meta = emptyMeta(lang);
  meta.source = { repo: SOURCE_REPO, commit, blobs: { ...blobs } };
  for (const ns of NAMESPACES) {
    if (!source[ns] || !targets[ns]) continue;
    const keys = Object.create(null);
    if (acceptAll) {
      for (const key of sortedKeys(source[ns])) {
        if (!(key in targets[ns])) continue;
        safeAssign(keys, key, { sourceHash: teHashSource(source[ns][key], key) });
      }
    }
    meta.namespaces[ns] = { targetBlobSha: namespaceBlobSha(targets[ns], Object.keys(source[ns])), keys };
  }
  return meta;
}

/** Fill one namespace of a metadata document from current source + target data. */
export function bootstrapNamespace(meta, lang, ns, source, target, { acceptAll = true } = {}) {
  const next = meta ? deepClone(meta) : emptyMeta(lang);
  next.hashVersion = HASH_VERSION;
  const keys = Object.create(null);
  if (acceptAll) {
    for (const key of sortedKeys(source)) {
      if (!(key in target)) continue;
      safeAssign(keys, key, { sourceHash: teHashSource(source[key], key) });
    }
  }
  next.namespaces[ns] = { targetBlobSha: namespaceBlobSha(target, Object.keys(source)), keys };
  return next;
}

/**
 * Apply accepted patch results to metadata immutably.
 * Unaffected namespaces and keys are preserved verbatim.
 *
 * @param {object} args
 * @param {object} args.meta current metadata (or null)
 * @param {string} args.lang
 * @param {string} args.ns
 * @param {object} args.source namespace source map
 * @param {object} args.newTarget resulting target map
 * @param {string[]} args.acceptedKeys keys whose source hash must be refreshed
 * @param {string[]} args.deletedKeys keys removed from metadata
 * @param {string|null} args.commit upstream source commit
 * @param {object} args.blobs upstream source blob SHAs
 */
export function updateMetaForPatch({
  meta, lang, ns, source, newTarget, acceptedKeys = [], deletedKeys = [],
  commit = undefined, blobs = {},
}) {
  const next = meta ? deepClone(meta) : emptyMeta(lang);
  next.schemaVersion = SCHEMA_VERSION;
  next.hashVersion = HASH_VERSION;
  next.lang = lang;
  if (commit !== undefined) next.source.commit = commit;
  for (const [key, value] of Object.entries(blobs || {})) next.source.blobs[key] = value;

  const nsMeta = next.namespaces[ns] || { targetBlobSha: null, keys: Object.create(null) };
  const keys = { ...nsMeta.keys };
  for (const key of deletedKeys) delete keys[key];
  for (const key of acceptedKeys) {
    if (!(key in source)) continue;
    safeAssign(keys, key, { sourceHash: teHashSource(source[key], key) });
  }
  next.namespaces[ns] = { targetBlobSha: namespaceBlobSha(newTarget, Object.keys(source)), keys };
  return next;
}

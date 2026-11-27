/**
 * Submission payload schema + immutable storage helpers.
 *
 * All untrusted fields are validated before any repository path is touched.
 * Only language/namespace/id components from strict allowlists reach the
 * filesystem, preventing path traversal and namespace injection.
 */
import {
  SCHEMA_VERSION, ID_RE, LANG_RE, NS_RE, KEY_RE, SHA1_RE, HASH_RE,
  MAX_CHANGES_PER_SUBMISSION, MAX_VALUE_LENGTH, MAX_PAYLOAD_BYTES,
  SOURCE_LANG, RESERVED_SUBMISSION_DIRS,
} from './constants.js';
import { isPlainObject, isUnsafeKey } from './util.js';

export function validatePayloadSize(text) {
  if (typeof text !== 'string') return { ok: false, errors: ['Payload must be text'] };
  if (Buffer.byteLength(text, 'utf8') > MAX_PAYLOAD_BYTES) {
    return { ok: false, errors: [`Payload exceeds ${MAX_PAYLOAD_BYTES} bytes`] };
  }
  return { ok: true, errors: [] };
}

/**
 * Validate and normalize an untrusted submission payload.
 * @returns {{ok: boolean, errors: string[], value?: object}}
 */
export function validateSubmission(payload, { langs, namespaces } = {}) {
  const errors = [];
  const fail = (msg) => errors.push(msg);

  if (!isPlainObject(payload)) return { ok: false, errors: ['Payload must be a JSON object'] };
  if (payload.schemaVersion !== SCHEMA_VERSION) fail(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (typeof payload.id !== 'string' || !ID_RE.test(payload.id)) fail('id must match the submission id format');
  const normalizedLang = typeof payload.lang === 'string' ? payload.lang.toLowerCase() : payload.lang;
  if (typeof payload.lang !== 'string' || !LANG_RE.test(payload.lang)) fail('lang is invalid');
  else if (normalizedLang === SOURCE_LANG || RESERVED_SUBMISSION_DIRS.has(normalizedLang)) {
    fail('lang is reserved');
  }
  if (typeof payload.ns !== 'string' || !NS_RE.test(payload.ns)) fail('ns is invalid');
  if (typeof payload.baseCommit !== 'string' || !SHA1_RE.test(payload.baseCommit)) fail('baseCommit must be a 40-hex SHA');

  if (Array.isArray(namespaces) && typeof payload.ns === 'string' && !namespaces.includes(payload.ns)) {
    fail('ns is not an allowed namespace');
  }

  if (payload.source !== undefined) {
    if (!isPlainObject(payload.source)) {
      fail('source must be an object');
    } else {
      if (payload.source.commit !== undefined && !SHA1_RE.test(payload.source.commit)) fail('source.commit must be a 40-hex SHA');
      if (payload.source.blobSha !== undefined && !SHA1_RE.test(payload.source.blobSha)) fail('source.blobSha must be a 40-hex SHA');
    }
  }

  if (!isPlainObject(payload.changes)) {
    fail('changes must be an object');
  } else {
    const keys = Object.keys(payload.changes);
    if (keys.length === 0) fail('changes must contain at least one key');
    if (keys.length > MAX_CHANGES_PER_SUBMISSION) fail(`changes exceeds ${MAX_CHANGES_PER_SUBMISSION} keys`);
    for (const key of keys) {
      if (typeof key !== 'string' || !KEY_RE.test(key) || isUnsafeKey(key)) {
        fail(`invalid translation key: ${JSON.stringify(key)}`);
        continue;
      }
      const change = payload.changes[key];
      if (!isPlainObject(change)) {
        fail(`change for ${key} must be an object`);
        continue;
      }
      if (change.op !== undefined && change.op !== 'set') fail(`unsupported op for ${key}`);
      if (typeof change.value !== 'string') fail(`value for ${key} must be a string`);
      else if (change.value.length > MAX_VALUE_LENGTH) fail(`value for ${key} is too long`);
      if (!HASH_RE.test(change.baseTargetHash || '')) fail(`baseTargetHash for ${key} must be a hash`);
      if (!HASH_RE.test(change.sourceHash || '')) fail(`sourceHash for ${key} must be a hash`);
    }
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    value: {
      schemaVersion: payload.schemaVersion,
      id: payload.id,
      lang: normalizedLang,
      ns: payload.ns,
      baseCommit: payload.baseCommit,
      source: payload.source || {},
      changes: payload.changes,
    },
  };
}

/** Build a canonical submission payload. */
export function createSubmission({ id, lang, ns, baseCommit, source = {}, changes }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    lang,
    ns,
    baseCommit,
    source,
    changes: Object.fromEntries(Object.entries(changes).map(([key, change]) => [key, {
      value: change.value,
      baseTargetHash: change.baseTargetHash,
      sourceHash: change.sourceHash,
    }])),
  };
}

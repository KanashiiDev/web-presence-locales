/**
 * Hashing primitives shared by the editor, the validator and the submission
 * processor.
 */
import { createHash } from 'node:crypto';
import { HASH_VERSION } from './constants.js';
import { serializeTranslations, stableStringify } from './util.js';

/** Domain separator per hash version. */
const DOMAIN_BY_VERSION = Object.freeze({ 1: 'web-presence-locales/v1' });
const DOMAIN = DOMAIN_BY_VERSION[HASH_VERSION];

export function domainForVersion(version) {
  const domain = DOMAIN_BY_VERSION[version];
  if (!domain) throw new Error(`Unsupported hash version: ${version}`);
  return domain;
}

export function isSupportedHashVersion(version) {
  return version === undefined || version === null || version === HASH_VERSION;
}

export function sha256(input) {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** SHA-1 of the Git blob representation of a byte string (matches `git hash-object`). */
export function gitBlobSha(content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  return createHash('sha1')
    .update(`blob ${buffer.length}\0`, 'utf8')
    .update(buffer)
    .digest('hex');
}

function requireString(value, label) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  return value;
}

/**
 * Hash of an English source string for a translation key.
 * This is the value stored as `sourceHash` in .meta.json and in submissions.
 */
export function teHashSource(value, key) {
  return sha256(`${DOMAIN}\nsource\n${requireString(key, 'key')}\n${requireString(value, 'source value')}`);
}

/** Recompute a source hash with an explicit (possibly legacy) algorithm version. */
export function teHashSourceForVersion(value, key, version = HASH_VERSION) {
  const domain = domainForVersion(version);
  return sha256(`${domain}\nsource\n${requireString(key, 'key')}\n${requireString(value, 'source value')}`);
}

/** Alias used by metadata and patch payloads. */
export const sourceHash = teHashSource;

/** Hash of a translated target string for a translation key. */
export function teHashTarget(value, key) {
  return sha256(`${DOMAIN}\ntarget\n${requireString(key, 'key')}\n${requireString(value, 'target value')}`);
}

/** Hash of the target value at the moment a draft was created (editor-side). */
export const draftBaseTargetHash = teHashTarget;

/** Hash of a whole namespace object, independent of object key insertion order. */
export function namespaceHash(obj) {
  return sha256(`${DOMAIN}\nnamespace\n${stableStringify(obj)}`);
}

/** Blob SHA of the canonical serialization of a namespace (equals git blob SHA). */
export function namespaceBlobSha(obj, order = null) {
  return gitBlobSha(serializeTranslations(obj, order));
}

/** Extract interpolation placeholders ({count}, {minutes}, ...) from a string. */
export function placeholdersOf(value) {
  const out = new Set();
  for (const match of String(value).matchAll(/\{([A-Za-z0-9_.]+)\}/g)) out.add(match[1]);
  return out;
}

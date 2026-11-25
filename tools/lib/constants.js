/**
 * Shared constants for the localization infrastructure.
 */

export const VALIDATOR_VERSION = 1;
export const SCHEMA_VERSION = 1;

/**
 * Version of the per-key source/target hash algorithm. Metadata written by this
 * code declares `hashVersion`. Older metadata without the field is treated as
 * version 1 (the original algorithm) and is migrated in-place when touched.
 * Bump this ONLY when the hash input (DOMAIN / normalization) changes.
 */
export const HASH_VERSION = 1;

/** Authoritative source language (owned by the main web-presence repository). */
export const SOURCE_LANG = 'en';
/** Login used by commits/comments created with the workflow GITHUB_TOKEN. */
export const PROCESSOR_BOT_LOGIN = 'github-actions[bot]';
export const SOURCE_REPO = process.env.SOURCE_REPO || 'KanashiiDev/web-presence';
export const SOURCE_BRANCH = process.env.SOURCE_BRANCH || 'main';
export const SOURCE_LOCALES_PATH = 'locales/en';

/** Translation namespaces. Kept in sync with the main application. */
export const NAMESPACES = Object.freeze(['extension', 'server', 'shared']);

/**
 * Display labels used when the processor auto-registers a brand new language.
 * Unknown codes fall back to the code itself.
 */
export const LANG_LABELS = Object.freeze({
  ar: 'Arabic', de: 'German', el: 'Greek', en: 'English', es: 'Spanish',
  fi: 'Finnish', fr: 'French', hi: 'Hindi', id: 'Indonesian', it: 'Italian',
  ja: 'Japanese', ko: 'Korean', nl: 'Dutch', pl: 'Polish', pt: 'Portuguese',
  'pt-br': 'Brazilian Portuguese',
  ru: 'Russian', sv: 'Swedish', tr: 'Turkish', uk: 'Ukrainian', zh: 'Chinese',
  'zh-cn': 'Chinese (China)', 'zh-tw': 'Chinese (Taiwan)',
});

/** Repository layout. */
export const LOCALES_DIR = 'locales';
export const META_FILE = '.meta.json';
export const SOURCE_META_FILE = '.source.json';
export const LANGUAGES_FILE = 'languages.json';
export const SUBMISSIONS_DIR = 'submissions';
/** Directories under submissions/ that are not submission intake folders. */
export const RESERVED_SUBMISSION_DIRS = new Set(['archive', 'results', 'review']);
export const RUNTIME_DIR = 'runtime';
export const MANIFEST_FILE = 'runtime/manifest.json';
export const RAW_BASE = `https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY || process.env.LOCALES_REPO || 'KanashiiDev/web-presence-locales'}`;

/**
 * Coverage required for a language to ENTER publication. Once published, a
 * language is sticky: it never leaves the manifest just because coverage drops
 * (the app falls back to English per key). Compare the raw ratio, never a
 * rounded percentage. See tools/lib/coverage.js.
 */
export const PUBLISH_THRESHOLD = 0.9;

/**
 * Optional allowlist for auto-registered languages (comma-separated codes).
 * When empty, any well-formed, non-reserved lowercase code is accepted.
 */
export const LANG_ALLOWLIST = new Set(
  (process.env.LANG_ALLOWLIST || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
);

/** Submission limits (defence against oversized / abusive payloads). */
export const MAX_PAYLOAD_BYTES = 512 * 1024;
export const MAX_CHANGES_PER_SUBMISSION = 5000;
export const MAX_VALUE_LENGTH = 20_000;

/** Validation patterns. */
export const SHA1_RE = /^[a-f0-9]{40}$/i;
export const HASH_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
export const LANG_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/i;
export const NS_RE = /^[a-z][a-z0-9_-]{0,31}$/;
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
export const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/;
export const PLACEHOLDER_RE = /\{([A-Za-z0-9_.]+)\}/g;

/** Keys that must never be accepted from untrusted payloads (prototype pollution). */
export const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Retry policy for transient GitHub/API failures. */
export const API_RETRIES = Number(process.env.API_RETRIES || 4);
export const API_RETRY_BASE_MS = Number(process.env.API_RETRY_BASE_MS || 500);
/** Hard timeout per HTTP attempt so a stuck socket cannot consume the whole job. */
export const API_TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS || 10_000);

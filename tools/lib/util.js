import { UNSAFE_KEYS } from './constants.js';

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function deepClone(value) {
  if (Array.isArray(value)) return value.map(deepClone);
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) safeAssign(out, k, deepClone(v));
    return out;
  }
  return value;
}

/** Deterministic serialization used only for hashing / comparison, never for writing files. */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/**
 * Canonical on-disk representation of a translation file (2-space JSON + newline).
 * When an `order` list is supplied (the English source key order), keys follow
 * it; remaining keys are appended in sorted order.
 */
export function serializeTranslations(obj, order = null) {
  let keys;
  if (order && Array.isArray(order)) {
    const preferred = order.filter((k) => k in obj);
    const rest = Object.keys(obj).filter((k) => !preferred.includes(k)).sort();
    keys = [...preferred, ...rest];
  } else {
    keys = Object.keys(obj);
  }
  const out = {};
  for (const key of keys) out[key] = obj[key];
  return `${JSON.stringify(out, null, 2)}\n`;
}

export function sortedKeys(obj) {
  return Object.keys(obj).sort();
}

export function nowIso() {
  return new Date().toISOString();
}

export function isUnsafeKey(key) {
  return typeof key !== 'string'
    || UNSAFE_KEYS.has(key)
    || key.includes('__proto__')
    || key.includes('\0')
    || key.includes('/')
    || key.includes('\\');
}

/** Assign into a null-prototype object without allowing prototype pollution. */
export function safeAssign(target, key, value) {
  if (isUnsafeKey(key)) throw new Error(`Unsafe translation key: ${JSON.stringify(key)}`);
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
  return target;
}

export function toPlain(obj) {
  return JSON.parse(JSON.stringify(obj));
}

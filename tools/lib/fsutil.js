import fsp from 'node:fs/promises';
import path from 'node:path';
import { isUnsafeKey } from './util.js';
import { ID_RE } from './constants.js';

/** Resolve a path inside a root, rejecting traversal outside of it. */
export function resolveWithin(root, ...segments) {
  const base = path.resolve(root);
  const target = path.resolve(base, ...segments.map(String));
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`Path traversal rejected: ${segments.join('/')}`);
  }
  return target;
}

/** Build a locale/submission file path from validated components. */
export function localePath(root, lang, file) {
  if (isUnsafeKey(lang) || lang.includes('/') || path.isAbsolute(lang)) {
    throw new Error(`Invalid language component: ${lang}`);
  }
  if (isUnsafeKey(file) || file.includes('/') || path.isAbsolute(file)) {
    throw new Error(`Invalid file component: ${file}`);
  }
  return resolveWithin(root, 'locales', lang, file);
}

export function submissionPath(root, lang, id) {
  if (isUnsafeKey(id) || id.includes('/') || path.isAbsolute(id)) {
    throw new Error(`Invalid submission id: ${id}`);
  }
  return resolveWithin(root, 'submissions', lang, `${id}.json`);
}

export async function readJson(file) {
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}

export async function readJsonIfExists(file) {
  try {
    return await readJson(file);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function readTextIfExists(file) {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Write a file only when its content actually differs (avoids needless rewrites). */
export async function writeIfChanged(file, content) {
  const current = await readTextIfExists(file);
  if (current === content) return false;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content, 'utf8');
  return true;
}

export async function listJsonFiles(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const groups = await Promise.all(entries.filter((e) => e.isDirectory()).map(async (e) => {
    const files = await fsp.readdir(path.join(dir, e.name));
    return files.filter((f) => f.endsWith('.json')).map((f) => ({ lang: e.name, id: f.slice(0, -5) }));
  }));
  return groups.flat().filter((x) => ID_RE.test(x.id)).sort((a, b) => a.id.localeCompare(b.id));
}

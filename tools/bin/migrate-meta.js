#!/usr/bin/env node
/**
 * One-time, visible migration of all language metadata to the current hash
 * version. Legacy metadata (no `hashVersion`) is upgraded by re-accepting each
 * key against the current English source.
 *
 *   node tools/bin/migrate-meta.js            # dry run
 *   node tools/bin/migrate-meta.js --write     # rewrite files
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAMESPACES, SOURCE_LANG, META_FILE } from '../lib/constants.js';
import { readLanguages } from '../lib/languages.js';
import { readLocalSource } from '../lib/source.js';
import { readMeta, ensureHashVersion, serializeMeta } from '../lib/metadata.js';
import { localePath, writeIfChanged } from '../lib/fsutil.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const write = process.argv.includes('--write');
const langs = await readLanguages(root);
const sourceState = await readLocalSource(root);
const report = { hashVersion: 1, migrated: [], unchanged: [] };

for (const lang of Object.keys(langs)) {
  if (lang === SOURCE_LANG) continue;
  const meta = await readMeta(root, lang);
  if (!meta) {
    report.unchanged.push(lang);
    continue;
  }
  const { meta: next, migrated } = ensureHashVersion(meta, sourceState.source);
  if (!migrated) {
    report.unchanged.push(lang);
    continue;
  }
  const file = localePath(root, lang, META_FILE);
  if (write) await writeIfChanged(file, serializeMeta(next));
  report.migrated.push({
    lang,
    namespaces: Object.keys(next.namespaces || {}).filter((ns) => NAMESPACES.includes(ns)).length,
  });
}

console.log(JSON.stringify({ mode: write ? 'write' : 'dry-run', ...report }, null, 2));

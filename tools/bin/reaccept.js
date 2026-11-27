#!/usr/bin/env node
/**
 * Re-accept selected outdated metadata entries against the current English
 * mirror. No translation file is changed.
 *
 *   node tools/bin/reaccept.js --keys key.one,key.two --write
 *   node tools/bin/reaccept.js --all-outdated --write
 *   node tools/bin/reaccept.js --all-unverified --write
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localePath, readJsonIfExists, writeIfChanged } from '../lib/fsutil.js';
import { readLanguages } from '../lib/languages.js';
import { serializeMeta } from '../lib/metadata.js';
import { planReaccept, applyReaccept } from '../lib/reaccept.js';
import { NAMESPACES, SOURCE_LANG, META_FILE } from '../lib/constants.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const keysIdx = process.argv.indexOf('--keys');
const keys = keysIdx >= 0 && process.argv[keysIdx + 1] ? process.argv[keysIdx + 1].split(',').map((key) => key.trim()).filter(Boolean) : null;
const langIdx = process.argv.indexOf('--lang');
const langFilter = langIdx >= 0 ? process.argv[langIdx + 1] : null;
const nsIdx = process.argv.indexOf('--ns');
const nsFilter = nsIdx >= 0 ? process.argv[nsIdx + 1] : null;
const write = process.argv.includes('--write');
const allOutdated = process.argv.includes('--all-outdated');
const allUnverified = process.argv.includes('--all-unverified');
const modes = [Boolean(keys), allOutdated, allUnverified].filter(Boolean).length;

if (modes !== 1) {
  console.error('Pass exactly one of --keys <comma-separated>, --all-outdated or --all-unverified');
  process.exit(2);
}

const langs = await readLanguages(root);
const written = [];
const planned = [];

for (const lang of Object.keys(langs).filter((code) => code !== SOURCE_LANG && (!langFilter || code === langFilter))) {
  for (const ns of NAMESPACES.filter((name) => !nsFilter || name === nsFilter)) {
    const source = await readJsonIfExists(localePath(root, SOURCE_LANG, `${ns}.json`));
    const target = await readJsonIfExists(localePath(root, lang, `${ns}.json`));
    const metaPath = localePath(root, lang, META_FILE);
    const meta = await readJsonIfExists(metaPath);
    if (!source || !target || !meta?.namespaces?.[ns]) continue;
    const plan = planReaccept({ source, target, meta: meta.namespaces[ns], keys, includeUnverified: allUnverified || Boolean(keys) });
    if (!plan.length) continue;
    planned.push({ lang, ns, keys: plan.map((entry) => entry.key) });
    if (!write) continue;
    const nextMeta = { ...meta, namespaces: { ...meta.namespaces, [ns]: applyReaccept({ meta: meta.namespaces[ns], plan }) } };
    if (await writeIfChanged(metaPath, serializeMeta(nextMeta))) written.push(`${lang}/${ns}`);
  }
}

console.log(JSON.stringify({ mode: write ? 'write' : 'dry-run', planned, written, note: 'Translation files are never modified' }, null, 2));

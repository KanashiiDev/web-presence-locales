#!/usr/bin/env node
/**
 * Editor-facing freshness data for opening a language/namespace.
 *
 *   node tools/bin/check-freshness.js --lang tr --ns extension
 *   node tools/bin/check-freshness.js --lang tr --ns extension --draft draft.json
 *
 * Prints a single JSON document with blob SHAs, per-key freshness and key-level
 * QA codes, all recomputed from current repository state.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAMESPACES, VALIDATOR_VERSION } from '../lib/constants.js';
import { readLocalSource } from '../lib/source.js';
import { readMeta } from '../lib/metadata.js';
import { checkLanguageOpen, compareDraft } from '../lib/freshness.js';
import { teValidateKey } from '../lib/qa.js';
import { localePath, readJson } from '../lib/fsutil.js';

function arg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lang = arg('lang', null);
const ns = arg('ns', null);
if (!lang) {
  console.error('Missing required --lang <code>');
  process.exit(1);
}
if (!NAMESPACES.includes(ns)) {
  console.error(`Unknown or missing --ns. Expected one of: ${NAMESPACES.join(', ')}`);
  process.exit(1);
}

const sourceState = await readLocalSource(root);
const source = sourceState.source[ns];
let target;
try {
  target = await readJson(localePath(root, lang, `${ns}.json`));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
  target = { ...source };
}
const meta = await readMeta(root, lang);

const freshness = await checkLanguageOpen({ source, target, meta, ns });
const qaErrors = {};
const qaWarnings = {};
for (const key of Object.keys(source)) {
  const verdict = teValidateKey({ key, source: source[key], value: target[key] ?? '' });
  if (verdict.errors.length) qaErrors[key] = verdict.errors.map((entry) => entry.code);
  if (verdict.warnings.length) qaWarnings[key] = verdict.warnings.map((entry) => entry.code);
}
const output = {
  lang,
  ns,
  validatorVersion: VALIDATOR_VERSION,
  upstreamCommit: sourceState.commit,
  freshness,
  qaErrors,
  qaWarnings,
};

const draftFile = arg('draft', null);
if (draftFile) {
  const draft = JSON.parse(await fs.readFile(draftFile, 'utf8'));
  output.draftComparison = compareDraft({ draft, source, target });
}

console.log(JSON.stringify(output, null, 2));

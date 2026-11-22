#!/usr/bin/env node
/**
 * Re-accept source hashes for keys whose English text changed only trivially
 * (whitespace, punctuation or a typo).
 *
 *   node tools/bin/reapprove.js --lang tr --ns extension --key common.save
 *   node tools/bin/reapprove.js --lang tr --ns extension --all --yes
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAMESPACES, SOURCE_LANG, META_FILE } from '../lib/constants.js';
import { readLanguages } from '../lib/languages.js';
import { readLocalSource } from '../lib/source.js';
import { readMeta, serializeMeta } from '../lib/metadata.js';
import { localePath, readJsonIfExists, writeIfChanged } from '../lib/fsutil.js';
import { teHashSource } from '../lib/hash.js';
import { safeAssign } from '../lib/util.js';

function argValues(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === `--${name}`) out.push(process.argv[i + 1]);
  }
  return out;
}
const value = (name, fallback = null) => {
  const v = argValues(name);
  return v.length ? v[v.length - 1] : fallback;
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lang = value('lang');
const ns = value('ns');
const keys = argValues('key');
const all = process.argv.includes('--all');
const yes = process.argv.includes('--yes');

if (!lang || lang === SOURCE_LANG || !NAMESPACES.includes(ns) || (!all && keys.length === 0)) {
  console.error('Usage: reapprove.js --lang <code> --ns <namespace> (--key <key> ... | --all) [--yes]');
  process.exit(1);
}
const langs = await readLanguages(root);
if (!Object.prototype.hasOwnProperty.call(langs, lang)) {
  console.error(`Unknown language: ${lang}`);
  process.exit(1);
}

const sourceState = await readLocalSource(root);
const source = sourceState.source[ns] || {};
const metaPath = localePath(root, lang, META_FILE);
const meta = await readJsonIfExists(metaPath);
if (!meta?.namespaces?.[ns]) {
  console.error(`No metadata for ${lang}/${ns}`);
  process.exit(1);
}
const selected = all ? Object.keys(meta.namespaces[ns].keys || {}) : keys;
const changes = [];
const next = structuredClone(meta);
for (const key of selected) {
  if (!(key in source)) {
    changes.push({ key, status: 'source-key-missing' });
    continue;
  }
  const oldHash = next.namespaces[ns].keys[key]?.sourceHash;
  const newHash = teHashSource(source[key], key);
  if (oldHash === newHash) {
    changes.push({ key, status: 'already-current' });
    continue;
  }
  changes.push({ key, status: 'reapproved', oldHash, newHash });
  safeAssign(next.namespaces[ns].keys, key, { sourceHash: newHash });
}

if (yes && changes.some((c) => c.status === 'reapproved')) {
  await writeIfChanged(metaPath, serializeMeta(next));
}
const reapprovedKeys = changes.filter((item) => item.status === 'reapproved').map((item) => item.key);
const suggestedCommitMessage = reapprovedKeys.length
  ? `chore: re-approve ${lang}/${ns} source hashes (${reapprovedKeys.join(', ')})`
  : null;
console.log(JSON.stringify({
  language: lang,
  namespace: ns,
  written: Boolean(yes),
  note: yes ? 'Remember to commit this metadata change.' : 'Dry run. Pass --yes to write a visible metadata change.',
  suggestedCommitMessage,
  reapprovedKeys,
  changes,
}, null, 2));

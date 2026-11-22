#!/usr/bin/env node
/**
 * Remove translation keys that no longer exist in the English source.
 *
 *   node tools/bin/prune-orphans.js                         # dry run (default)
 *   node tools/bin/prune-orphans.js --apply                 # write changes
 *   node tools/bin/prune-orphans.js --lang tr --ns shared   # limit scope
 *
 * Safety: refuses to run when the local English mirror does not match the blob
 * SHAs recorded in locales/en/.source.json (run sync-source first). This is
 * opt-in: no workflow calls it automatically.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fsp from 'node:fs/promises';
import { NAMESPACES, SOURCE_LANG, SOURCE_META_FILE } from '../lib/constants.js';
import { localePath, readJsonIfExists } from '../lib/fsutil.js';
import { readLocalSource } from '../lib/source.js';
import { readLanguages } from '../lib/languages.js';
import { gitBlobSha } from '../lib/hash.js';
import { planOrphanCleanup, applyOrphanCleanup } from '../lib/orphans.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const value = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
};
const apply = process.argv.includes('--apply');
const langFilter = value('lang');
const nsFilter = value('ns');
if (nsFilter && !NAMESPACES.includes(nsFilter)) {
  console.error(`Unknown namespace: ${nsFilter}`);
  process.exit(1);
}

const sourceMeta = await readJsonIfExists(localePath(root, SOURCE_LANG, SOURCE_META_FILE));
const recordedBlobs = sourceMeta?.blobs || sourceMeta?.upstream?.blobs;
if (!recordedBlobs) {
  console.error('No recorded source blobs in locales/en/.source.json; run sync-source first.');
  process.exit(1);
}
const sourceState = await readLocalSource(root);
for (const ns of NAMESPACES) {
  const file = localePath(root, SOURCE_LANG, `${ns}.json`);
  const text = await fsp.readFile(file, 'utf8');
  if (gitBlobSha(text) !== recordedBlobs[ns]) {
    console.error(`English mirror ${ns} differs from recorded blob; run sync-source first.`);
    process.exit(1);
  }
}

const langs = await readLanguages(root);
const plans = await planOrphanCleanup({ root, sourceState, langs, langFilter, nsFilter });
const report = {
  mode: apply ? 'apply' : 'dry-run',
  filesAffected: plans.length,
  targetKeysRemoved: plans.reduce((sum, plan) => sum + plan.orphanTargetKeys.length, 0),
  metaKeysRemoved: plans.reduce((sum, plan) => sum + plan.orphanMetaKeys.length, 0),
  details: plans.map((plan) => ({
    lang: plan.lang,
    ns: plan.ns,
    targetKeys: plan.orphanTargetKeys,
    metaKeys: plan.orphanMetaKeys,
  })),
};
if (apply) Object.assign(report, await applyOrphanCleanup({ plans }));
console.log(JSON.stringify(report, null, 2));

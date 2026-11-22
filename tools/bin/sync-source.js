#!/usr/bin/env node
/**
 * Refresh the derived English mirror from the main web-presence repository.
 * The mirror is never edited by contributors and is never a source of truth:
 * it exists so the editor and runtime manifest can work offline.
 *
 *   GITHUB_TOKEN=... node tools/bin/sync-source.js --token ...
 *   GITHUB_TOKEN=... node tools/bin/sync-source.js --ref <sha>   # pin a commit
 *   node tools/bin/sync-source.js            # verify local mirror only
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fsp from 'node:fs/promises';
import { fetchGithubSource, readLocalSource } from '../lib/source.js';
import { localePath, readJsonIfExists, writeIfChanged, resolveWithin } from '../lib/fsutil.js';
import { serializeTranslations } from '../lib/util.js';
import { ensureHashVersion, serializeMeta } from '../lib/metadata.js';
import { readLanguages } from '../lib/languages.js';
import { planOrphanCleanup, applyOrphanCleanup } from '../lib/orphans.js';
import { NAMESPACES, SOURCE_LANG, SOURCE_REPO, SOURCE_BRANCH, META_FILE } from '../lib/constants.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const idx = process.argv.indexOf('--token');
const token = idx >= 0 ? process.argv[idx + 1] : process.env.GITHUB_TOKEN;
const refIdx = process.argv.indexOf('--ref');
const ref = refIdx >= 0 ? process.argv[refIdx + 1] : (process.env.SOURCE_SHA || SOURCE_BRANCH);

if (!token) {
  const local = await readLocalSource(root);
  console.log(JSON.stringify({
    mode: 'verify',
    commit: local.commit,
    blobs: local.blobs,
    note: 'No token supplied: verified local mirror only. Pass --token to fetch upstream.',
  }, null, 2));
  process.exit(0);
}

const upstream = await fetchGithubSource({ token, ref });
const local = await readLocalSource(root);
const changed = [];
const cleanupOrphans = String(process.env.CLEANUP_ORPHANS || '') === 'true';
const metaOrphansRemoved = [];

for (const ns of NAMESPACES) {
  const file = localePath(root, SOURCE_LANG, `${ns}.json`);
  const text = upstream.raw?.[ns] ?? serializeTranslations(upstream.source[ns]);
  if (await writeIfChanged(file, text)) changed.push(ns);
}
const sourceMetaFile = localePath(root, SOURCE_LANG, '.source.json');
const existingMeta = await readJsonIfExists(sourceMetaFile);
const sourceMeta = JSON.stringify({
  repo: SOURCE_REPO,
  branch: process.env.SOURCE_BRANCH || SOURCE_BRANCH,
  commit: upstream.commit,
  blobs: upstream.blobs,
  ...(existingMeta?.renames ? { renames: existingMeta.renames } : {}),
}, null, 2);
if (await writeIfChanged(sourceMetaFile, `${sourceMeta}\n`)) changed.push('.source.json');

const renames = existingMeta?.renames || {};
const langs = await readLanguages(root);
for (const lang of Object.keys(langs)) {
  if (lang === SOURCE_LANG) continue;
  const metaPath = localePath(root, lang, META_FILE);
  let meta = await readJsonIfExists(metaPath);
  const migrated = ensureHashVersion(meta, upstream.source);
  meta = migrated.meta;
  if (migrated.migrated) changed.push(`${lang}/${META_FILE}`);

  for (const ns of NAMESPACES) {
    const sourceKeys = upstream.source[ns] || {};
    const targetPath = localePath(root, lang, `${ns}.json`);
    let target = await readJsonIfExists(targetPath);
    if (target) {
      let targetChanged = false;
      for (const [oldKey, newKey] of Object.entries(renames)) {
        if (oldKey in target) {
          target[newKey] = target[oldKey];
          delete target[oldKey];
          targetChanged = true;
        }
      }
      if (targetChanged) {
        await writeIfChanged(targetPath, serializeTranslations(target, Object.keys(sourceKeys)));
        changed.push(`${lang}/${ns}.json`);
      }
    }

    if (!meta?.namespaces?.[ns]) continue;
    const nsMeta = meta.namespaces[ns];
    const keys = nsMeta.keys || {};
    let metaChanged = false;
    for (const [oldKey, newKey] of Object.entries(renames)) {
      if (oldKey in keys) {
        keys[newKey] = keys[oldKey];
        delete keys[oldKey];
        metaChanged = true;
      }
    }
    for (const key of Object.keys(keys)) {
      if (!(key in sourceKeys)) {
        delete keys[key];
        metaOrphansRemoved.push({ lang, ns, key });
        metaChanged = true;
      }
    }
    if (metaChanged) changed.push(`${lang}/${META_FILE}`);
    nsMeta.keys = keys;
    nsMeta.targetBlobSha = nsMeta.targetBlobSha ?? null;
  }

  if (meta) {
    meta.source = { ...(meta.source || {}), commit: upstream.commit, blobs: upstream.blobs };
    if (await writeIfChanged(metaPath, serializeMeta(meta))) {
      if (!changed.includes(`${lang}/${META_FILE}`)) changed.push(`${lang}/${META_FILE}`);
    }
  }
}

let orphanCleanup = null;
if (cleanupOrphans) {
  // Renames and metadata orphans were already handled above. This pass removes
  // the remaining stale keys from the target files themselves.
  const plans = await planOrphanCleanup({ root, sourceState: { source: upstream.source }, langs });
  const reportPath = resolveWithin(root, 'runtime/orphan-cleanup', `${upstream.commit}.json`);
  orphanCleanup = {
    sourceCommit: upstream.commit,
    targetKeys: plans.flatMap((plan) => plan.orphanTargetKeys.map((key) => ({ lang: plan.lang, ns: plan.ns, key }))),
    metaKeys: metaOrphansRemoved,
  };
  if (plans.length) await applyOrphanCleanup({ plans });
  await fsp.mkdir(path.dirname(reportPath), { recursive: true });
  if (await writeIfChanged(reportPath, `${JSON.stringify(orphanCleanup, null, 2)}\n`)) {
    changed.push(`runtime/orphan-cleanup/${upstream.commit}.json`);
  }
}

console.log(JSON.stringify({
  mode: 'sync',
  commit: upstream.commit,
  previousCommit: local.commit,
  ref,
  changed,
  cleanupOrphans,
  orphanCleanup: orphanCleanup
    ? { removedFromTargets: orphanCleanup.targetKeys.length, removedFromMeta: orphanCleanup.metaKeys.length }
    : null,
}, null, 2));

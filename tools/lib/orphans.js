/**
 * Plan and apply removal of keys that no longer exist in the English source.
 *
 * Split from the CLI so tests can exercise the exact production logic. The
 * source is always the local English mirror, never a target file.
 */
import fsp from 'node:fs/promises';
import { NAMESPACES, SOURCE_LANG, META_FILE } from './constants.js';
import { localePath, readJsonIfExists } from './fsutil.js';
import { serializeTranslations } from './util.js';
import { serializeMeta } from './metadata.js';
import { namespaceBlobSha } from './hash.js';

/**
 * Build a dry-run plan. Nothing is written.
 * @returns {Array<object>} one entry per lang/namespace with orphan keys
 */
export async function planOrphanCleanup({ root, sourceState, langs, langFilter = null, nsFilter = null }) {
  const plans = [];
  for (const lang of Object.keys(langs)) {
    if (lang === SOURCE_LANG || (langFilter && lang !== langFilter)) continue;
    for (const ns of NAMESPACES) {
      if (nsFilter && ns !== nsFilter) continue;
      const source = sourceState.source[ns] || {};
      const sourceOrder = Object.keys(source);
      const targetPath = localePath(root, lang, `${ns}.json`);
      const metaPath = localePath(root, lang, META_FILE);
      const target = await readJsonIfExists(targetPath);
      const meta = await readJsonIfExists(metaPath);
      const orphanTargetKeys = target ? Object.keys(target).filter((key) => !(key in source)) : [];
      const nsMeta = meta?.namespaces?.[ns];
      const orphanMetaKeys = nsMeta ? Object.keys(nsMeta.keys || {}).filter((key) => !(key in source)) : [];
      if (!orphanTargetKeys.length && !orphanMetaKeys.length) continue;
      plans.push({ lang, ns, targetPath, metaPath, target, meta, sourceOrder, orphanTargetKeys, orphanMetaKeys });
    }
  }
  return plans;
}

/** Apply a previously computed plan. Files without orphans are untouched. */
export async function applyOrphanCleanup({ plans }) {
  let filesWritten = 0;
  for (const plan of plans) {
    if (plan.target) {
      for (const key of plan.orphanTargetKeys) delete plan.target[key];
      await fsp.writeFile(plan.targetPath, serializeTranslations(plan.target, plan.sourceOrder), 'utf8');
      filesWritten += 1;
    }
    if (plan.meta?.namespaces?.[plan.ns]) {
      const nsMeta = plan.meta.namespaces[plan.ns];
      for (const key of plan.orphanMetaKeys) delete nsMeta.keys[key];
      if (plan.target) {
        nsMeta.targetBlobSha = namespaceBlobSha(plan.target, plan.sourceOrder);
      }
      await fsp.writeFile(plan.metaPath, serializeMeta(plan.meta), 'utf8');
      filesWritten += 1;
    }
  }
  return { filesWritten };
}

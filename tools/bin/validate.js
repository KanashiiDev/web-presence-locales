#!/usr/bin/env node
/** Repository-wide localization validation. Used in CI on every PR. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NAMESPACES, LOCALES_DIR, META_FILE, VALIDATOR_VERSION, MANIFEST_FILE, SOURCE_LANG,
} from '../lib/constants.js';
import { readLanguages } from '../lib/languages.js';
import { readLocalSource } from '../lib/source.js';
import { readMeta, bootstrapMeta, writeMeta, ensureHashVersion, serializeMeta } from '../lib/metadata.js';
import { checkLanguageOpen } from '../lib/freshness.js';
import { validateMeta, validateNamespaceSet, validateTranslation } from '../lib/validation.js';
import { localePath, readJsonIfExists, resolveWithin } from '../lib/fsutil.js';
import { gitBlobSha } from '../lib/hash.js';
import fsp from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const writeMetaFlag = process.argv.includes('--write-meta');

const langs = await readLanguages(root);
const sourceState = await readLocalSource(root);
const sourceMirror = await readJsonIfExists(localePath(root, SOURCE_LANG, '.source.json'));
const report = { validatorVersion: VALIDATOR_VERSION, sourceCommit: sourceState.commit, languages: {}, errors: [], warnings: [], warningCounts: {} };
const warn = (code, message) => {
  report.warnings.push(message);
  report.warningCounts[code] = (report.warningCounts[code] || 0) + 1;
};

const recordedBlobs = sourceMirror?.upstream?.blobs ?? sourceMirror?.blobs;
const recordedCommit = sourceMirror?.upstream?.commit ?? sourceMirror?.commit;
if (recordedBlobs) {
  for (const ns of NAMESPACES) {
    const local = sourceState.blobs[ns];
    const upstream = recordedBlobs[ns];
    if (upstream && upstream !== local) {
      warn('source-mirror-drift', `source mirror ${ns} differs from recorded upstream ${recordedCommit}; run sync-source`);
    }
  }
}

function enabledNamespaces(lang) {
  return NAMESPACES.filter((ns) => ns === 'shared' || langs[lang]?.[ns] === true);
}

for (const lang of Object.keys(langs)) {
  if (lang === SOURCE_LANG) continue;
  const available = enabledNamespaces(lang);
  const targets = Object.create(null);
  for (const ns of available) {
    const target = await readJsonIfExists(localePath(root, lang, `${ns}.json`));
    if (target === null) report.errors.push(`${lang}/${ns}: translation file is missing`);
    targets[ns] = target;
  }

  const presentNamespaces = available.filter((ns) => targets[ns] !== null);
  const namespaceIssues = validateNamespaceSet({ langs, lang, availableNamespaces: presentNamespaces });

  let meta = await readMeta(root, lang);
  const migration = ensureHashVersion(meta, sourceState.source);
  meta = migration.meta;
  if (migration.migrated) {
    warn('hashVersion-migrated', `${lang}: metadata hashVersion migrated to current version`);
    if (writeMetaFlag) {
      const file = localePath(root, lang, META_FILE);
      await fsp.writeFile(file, serializeMeta(meta), 'utf8');
      console.log(`[migrate] updated hashVersion in locales/${lang}/${META_FILE}`);
    }
  }

  if (!meta && !writeMetaFlag) {
    warn('meta-missing', `${lang}: ${META_FILE} is missing; run validate.js --write-meta to bootstrap`);
  }

  if (!meta && writeMetaFlag) {
    const allTargets = Object.fromEntries(NAMESPACES.map((ns) => [ns, targets[ns] || {}]));
    meta = bootstrapMeta(lang, sourceState.source, allTargets, {
      commit: sourceState.commit, blobs: sourceState.blobs,
    });
    await writeMeta(root, lang, meta);
    console.log(`[bootstrap] wrote locales/${lang}/${META_FILE}`);
  }

  if (meta) {
    for (const issue of validateMeta({ meta, lang, sourceByNamespace: sourceState.source })) {
      const prefix = issue.key ? `${lang}/${issue.key}` : lang;
      if (issue.severity === 'error') report.errors.push(`${prefix}: ${issue.message}`);
      else warn(`meta-${issue.code}`, `${prefix}: ${issue.message}`);
    }
  }

  const languageReport = { namespaces: {}, metaPresent: Boolean(meta) };
  for (const ns of presentNamespaces) {
    const target = targets[ns];
    const translationIssues = validateTranslation({ source: sourceState.source[ns], target });
    const errors = translationIssues.filter((i) => i.severity === 'error');
    const warnings = translationIssues.filter((i) => i.severity === 'warning');
    const freshness = await checkLanguageOpen({
      source: sourceState.source[ns], target, meta, ns,
    });

    for (const issue of freshness.outdatedKeys) {
      warn('outdated', `${lang}/${ns}: ${issue} is outdated (source hash changed)`);
    }
    for (const issue of freshness.unverifiedKeys) {
      warn('unverified', `${lang}/${ns}: ${issue} has no accepted metadata entry`);
    }

    languageReport.namespaces[ns] = {
      qaErrors: errors,
      qaWarnings: warnings,
      freshness: {
        isUpToDate: freshness.isUpToDate,
        translated: freshness.translated,
        total: freshness.total,
        missingKeys: freshness.missingKeys,
        extraKeys: freshness.extraKeys,
        outdatedKeys: freshness.outdatedKeys,
        unverifiedKeys: freshness.unverifiedKeys,
      },
    };
    for (const issue of errors) report.errors.push(`${lang}/${ns}: ${issue.key || ''} ${issue.message}`);
    for (const issue of warnings) {
      if (issue.code === 'same-as-source') {
        report.warningCounts[issue.code] = (report.warningCounts[issue.code] || 0) + 1;
        continue;
      }
      warn(issue.code, `${lang}/${ns}: ${issue.key || ''} ${issue.message}`);
    }
  }
  for (const issue of namespaceIssues) report.errors.push(`${lang}: ${issue.message}`);
  report.languages[lang] = languageReport;
}

const manifest = await readJsonIfExists(resolveWithin(root, MANIFEST_FILE));
if (manifest?.languages) {
  for (const lang of Object.keys(manifest.languages)) {
    if (langs[lang]?.published === false) continue;
    for (const [ns, info] of Object.entries(manifest.languages[lang].files || {})) {
      const target = await readJsonIfExists(localePath(root, lang, `${ns}.json`));
      if (target === null) continue;
      const text = await fsp.readFile(localePath(root, lang, `${ns}.json`), 'utf8');
      if (gitBlobSha(text) !== info.sha) {
        warn('manifest-stale', `manifest languages section is stale for ${lang}/${ns}; run manifest.js --write`);
      }
    }
  }
}

console.log(JSON.stringify(report, null, 2));
if (report.errors.length) {
  console.error(`\nValidation failed with ${report.errors.length} error(s).`);
  process.exitCode = 1;
} else {
  console.log(`\nValidation OK (${report.warnings.length} warning(s)).`);
}

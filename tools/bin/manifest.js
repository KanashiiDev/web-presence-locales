#!/usr/bin/env node
/**
 * Generate the runtime translation manifest.
 *
 * The application fetches this manifest to discover the latest translation
 * version, then fetches every locale file from the SAME immutable commit SHA
 * so multiple files are always consistent with one another.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NAMESPACES, SOURCE_LANG, SOURCE_REPO, META_FILE,
  RAW_BASE, VALIDATOR_VERSION, MANIFEST_FILE, SCHEMA_VERSION, SOURCE_META_FILE, SHA1_RE,
} from '../lib/constants.js';
import { resolveWithin, writeIfChanged, localePath, readJsonIfExists } from '../lib/fsutil.js';
import { readLanguages } from '../lib/languages.js';
import { gitBlobSha } from '../lib/hash.js';
import { computeCoverage, resolvePublished } from '../lib/coverage.js';
import { resolveSnapshot } from '../lib/manifest-state.js';
import { localHeadSafe } from '../lib/manifest-util.js';
import fsp from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const langs = await readLanguages(root);
const candidateSnapshot = process.env.SNAPSHOT_SHA || localHeadSafe(root);
const sourceMetaPath = localePath(root, SOURCE_LANG, SOURCE_META_FILE);
let sourceMeta;
try {
  sourceMeta = JSON.parse(await fsp.readFile(sourceMetaPath, 'utf8'));
} catch (err) {
  throw new Error(`Cannot read ${SOURCE_META_FILE}: ${err.message}. Sync the English source before publishing a manifest.`);
}
// The editor and the dashboard server both reject a manifest whose
// source.commit is not a 40-hex SHA. Publishing one would take every client
// offline, so fail loudly instead of emitting `mirrorOnly: true`.
const sourceCommit = sourceMeta?.commit ?? sourceMeta?.upstream?.commit;
if (!SHA1_RE.test(sourceCommit || '')) {
  throw new Error(`${SOURCE_META_FILE} has no valid upstream commit; refusing to publish an invalid manifest.`);
}

const manifestPath = resolveWithin(root, MANIFEST_FILE);
const previousManifest = await readJsonIfExists(manifestPath);
if (!previousManifest?.languages) {
  console.warn('WARNING: runtime/manifest.json is missing or has no languages section; '
    + 'sticky publish state is unavailable and previously published languages may drop out.');
}

const source = Object.fromEntries(await Promise.all(
  NAMESPACES.map(async (ns) => [ns, JSON.parse(await fsp.readFile(localePath(root, SOURCE_LANG, `${ns}.json`), 'utf8'))]),
));

const languages = {};
for (const lang of Object.keys(langs)) {
  if (lang === SOURCE_LANG) continue;

  const meta = await readJsonIfExists(localePath(root, lang, META_FILE));
  const targets = {};
  const metas = {};
  for (const ns of NAMESPACES) {
    targets[ns] = await readJsonIfExists(localePath(root, lang, `${ns}.json`)) || {};
    metas[ns] = meta?.namespaces?.[ns] || {};
  }
  const coverage = computeCoverage({ source, targets, metas });
  const published = resolvePublished({
    coverage: coverage.coverage,
    previousPublished: previousManifest?.languages?.[lang]?.published === true,
    override: langs[lang]?.published,
  });
  if (!published) continue;

  const files = {};
  for (const ns of NAMESPACES) {
    if (ns !== 'shared' && langs[lang]?.[ns] !== true) continue;
    const file = localePath(root, lang, `${ns}.json`);
    const text = await fsp.readFile(file, 'utf8');
    // URLs are added by buildManifest() once the final snapshot is known.
    files[ns] = { sha: gitBlobSha(text) };
  }
  languages[lang] = {
    label: langs[lang].label,
    coverage: coverage.coverage,
    published,
    files,
  };
}

function buildManifest(snapshot) {
  return {
    schemaVersion: SCHEMA_VERSION,
    validatorVersion: VALIDATOR_VERSION,
    snapshot,
    source: {
      repo: SOURCE_REPO,
      commit: sourceCommit,
      mirrorOnly: false,
      blobs: sourceMeta?.upstream?.blobs ?? sourceMeta?.blobs ?? {},
    },
    languages: Object.fromEntries(Object.entries(languages).map(([lang, entry]) => [
      lang,
      {
        ...entry,
        files: Object.fromEntries(Object.entries(entry.files).map(([ns, file]) => [
          ns,
          { ...file, url: `${RAW_BASE}/${snapshot}/locales/${lang}/${ns}.json` },
        ])),
      },
    ])),
  };
}

// Keep the committed snapshot when no meaningful content changed; otherwise
// every workflow run would create a no-op "refresh" commit.
const provisional = buildManifest(candidateSnapshot);
const snapshot = resolveSnapshot({ candidate: candidateSnapshot, manifest: provisional, previousManifest });
const manifest = snapshot === candidateSnapshot ? provisional : buildManifest(snapshot);

const text = `${JSON.stringify(manifest, null, 2)}\n`;
if (process.argv.includes('--write')) {
  const changed = await writeIfChanged(manifestPath, text);
  console.log(changed
    ? `Wrote ${MANIFEST_FILE} (snapshot ${snapshot})`
    : `${MANIFEST_FILE} unchanged (snapshot ${snapshot})`);
} else {
  console.log(text);
}

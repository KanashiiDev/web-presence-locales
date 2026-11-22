/**
 * Manifest idempotency.
 *
 * `snapshot` changes on every commit, but the manifest only needs to be
 * republished when its meaningful content changes (locale file SHAs, coverage,
 * publication flags or source metadata). Without this, every manifest workflow
 * run produces a no-op "refresh" commit one step after the previous one.
 */

/** Content fingerprint that deliberately ignores snapshot-derived URLs. */
export function manifestFingerprint(manifest) {
  if (!manifest) return null;
  const languages = Object.fromEntries(Object.entries(manifest.languages || {}).map(([lang, entry]) => [
    lang,
    {
      label: entry.label,
      coverage: entry.coverage,
      published: entry.published,
      files: Object.fromEntries(Object.entries(entry.files || {}).map(([ns, file]) => [ns, { sha: file.sha }])),
    },
  ]));
  return JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    validatorVersion: manifest.validatorVersion,
    source: manifest.source,
    languages,
  });
}

/**
 * Keep the committed snapshot when the freshly built manifest has the same
 * meaningful content. The generated file then stays byte-identical and
 * writeIfChanged() becomes a no-op, so no second empty commit is created.
 */
export function resolveSnapshot({ candidate, manifest, previousManifest }) {
  if (!previousManifest?.snapshot || !manifest) return candidate;
  return manifestFingerprint(manifest) === manifestFingerprint(previousManifest)
    ? previousManifest.snapshot
    : candidate;
}

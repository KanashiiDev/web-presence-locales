/**
 * Authoritative English source access.
 *
 * The main `web-presence` repository owns `locales/en/*.json`. This repository
 * keeps a derived, read-only mirror under locales/en for offline use and for
 * the runtime manifest; `sync-source.js` refreshes it and records the upstream
 * commit + blob SHAs in locales/en/.source.json.
 *
 * Two providers:
 *  - local:  read the mirror from disk (offline / editor).
 *  - github: fetch directly from the main repository at a pinned ref (CI).
 */
import fsp from 'node:fs/promises';
import {
  NAMESPACES, SOURCE_LANG, SOURCE_REPO, SOURCE_BRANCH, SOURCE_LOCALES_PATH,
} from './constants.js';
import { localePath, readJsonIfExists } from './fsutil.js';
import { gitBlobSha } from './hash.js';
import { toPlain, isPlainObject } from './util.js';
import { githubJson, githubFetch } from './http.js';

/** Read the local English mirror. */
export async function readLocalSource(root) {
  const source = Object.create(null);
  const blobs = Object.create(null);
  for (const ns of NAMESPACES) {
    const file = localePath(root, SOURCE_LANG, `${ns}.json`);
    const text = await fsp.readFile(file, 'utf8');
    source[ns] = toPlain(JSON.parse(text));
    blobs[ns] = gitBlobSha(text);
  }
  const upstream = await readJsonIfExists(localePath(root, SOURCE_LANG, '.source.json'));
  return { source: toPlain(source), blobs, commit: upstream?.commit ?? null, provider: 'local' };
}

/** Resolve a branch/tag name to a commit SHA through the GitHub API. */
export async function resolveSourceRef({ owner = SOURCE_REPO.split('/')[0], repo = SOURCE_REPO.split('/')[1],
  ref = SOURCE_BRANCH, token } = {}) {
  const data = await githubJson(`/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`, { token });
  return data.sha;
}

/** Fetch English source files from the main repository at a pinned commit. */
export async function fetchGithubSource({ owner = SOURCE_REPO.split('/')[0], repo = SOURCE_REPO.split('/')[1],
  ref = SOURCE_BRANCH, token, namespaces = NAMESPACES } = {}) {
  const commit = /^[a-f0-9]{40}$/i.test(ref) ? ref : await resolveSourceRef({ owner, repo, ref, token });
  const source = Object.create(null);
  const raw = Object.create(null);
  const blobs = Object.create(null);
  for (const ns of namespaces) {
    const path = `${SOURCE_LOCALES_PATH}/${ns}.json`;
    const response = await githubFetch(`/repos/${owner}/${repo}/contents/${path}?ref=${commit}`, {
      token,
      headers: { Accept: 'application/vnd.github.raw+json' },
    });
    if (!response.ok) {
      throw new Error(`GitHub API ${response.status} while fetching ${path}`);
    }
    const text = await response.text();
    const parsed = JSON.parse(text);
    if (!isPlainObject(parsed) || Object.values(parsed).some((v) => typeof v !== 'string')) {
      throw new Error(`Source ${path} must be a flat string map`);
    }
    source[ns] = toPlain(parsed);
    raw[ns] = text;
    blobs[ns] = gitBlobSha(text);
  }
  return { source: toPlain(source), raw: toPlain(raw), blobs, commit, provider: 'github' };
}


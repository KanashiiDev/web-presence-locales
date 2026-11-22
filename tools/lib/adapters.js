/**
 * I/O adapters. The processor is written against this interface so the exact
 * same logic runs locally (dry runs) and against the GitHub API (CI).
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  LOCALES_DIR, SUBMISSIONS_DIR, RESULTS_DIR, RESERVED_SUBMISSION_DIRS,
  META_FILE, SOURCE_LANG, SOURCE_REPO, SOURCE_BRANCH, ID_RE,
} from './constants.js';
import {
  localePath, submissionPath, resolveWithin, readJson, readJsonIfExists, listJsonFiles,
} from './fsutil.js';
import { readLanguages } from './languages.js';
import { readLocalSource, fetchGithubSource } from './source.js';
import { toPlain } from './util.js';
import { localHead } from './git.js';
import { localHeadSafe } from './manifest-util.js';
import { githubJson, githubGraphql, githubFetch } from './http.js';

/* -------------------------------------------------------------------------- */
/* Local adapter                                                              */
/* -------------------------------------------------------------------------- */

export function createLocalAdapter(root) {
  return {
    mode: 'local',
    root,
    async getHead() {
      try {
        return localHead(root);
      } catch {
        return '0'.repeat(40);
      }
    },
    async readLanguages() {
      return readLanguages(root);
    },
    async readSource() {
      return readLocalSource(root);
    },
    async listPending() {
      const dir = resolveWithin(root, SUBMISSIONS_DIR);
      const items = await listJsonFiles(dir);
      return items.filter((x) => ID_RE.test(x.id) && !RESERVED_SUBMISSION_DIRS.has(x.lang));
    },
    async readSubmissionText(lang, id) {
      return fsp.readFile(submissionPath(root, lang, id), 'utf8');
    },
    async readSubmission(lang, id) {
      return readJson(submissionPath(root, lang, id));
    },
    async readTarget(lang, ns) {
      return readJson(localePath(root, lang, `${ns}.json`));
    },
    async readMeta(lang) {
      return readJsonIfExists(localePath(root, lang, META_FILE));
    },
    async hasProcessed(id) {
      if (!ID_RE.test(id)) throw new Error('Invalid submission id');
      try {
        await fsp.access(resolveWithin(root, RESULTS_DIR, `${id}.json`));
        return true;
      } catch {
        return false;
      }
    },
    async commit({ files, deletions, message }) {
      for (const { path: rel, content } of files) {
        const full = resolveWithin(root, rel);
        await fsp.mkdir(path.dirname(full), { recursive: true });
        await fsp.writeFile(full, content, 'utf8');
      }
      for (const rel of deletions || []) {
        try {
          await fsp.unlink(resolveWithin(root, rel));
        } catch (err) {
          if (err.code !== 'ENOENT') throw err;
        }
      }
      return { oid: localHeadSafe(root), message };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* GitHub adapter                                                             */
/* -------------------------------------------------------------------------- */

export class HeadChangedError extends Error {
  constructor(expected, actual) {
    super(`Repository HEAD changed during processing (expected ${expected}, got ${actual})`);
    this.name = 'HeadChangedError';
    this.expected = expected;
    this.actual = actual;
  }
}

export function createGitHubAdapter({
  token, owner = process.env.GITHUB_REPOSITORY_OWNER || SOURCE_REPO.split('/')[0],
  repo = (process.env.GITHUB_REPOSITORY || '').split('/')[1] || 'web-presence-locales',
  branch = process.env.GITHUB_REF_NAME || SOURCE_BRANCH,
} = {}) {
  if (!token) throw new Error('GITHUB_TOKEN is required for the GitHub adapter');
  const repoPath = `/repos/${owner}/${repo}`;

  async function readFileAt(rel, ref, { raw = false } = {}) {
    const endpoint = `${repoPath}/contents/${rel}?ref=${encodeURIComponent(ref)}`;
    try {
      if (raw) {
        const response = await githubFetch(endpoint, {
          token,
          headers: { Accept: 'application/vnd.github.raw+json' },
        });
        if (!response.ok) {
          const body = (await response.text()).slice(0, 200);
          const err = new Error(`GitHub API ${response.status}: ${body}`);
          err.status = response.status;
          throw err;
        }
        const text = await response.text();
        return { text, json: () => JSON.parse(text) };
      }
      const data = await githubJson(endpoint, { token });
      if (data.type !== 'file' || typeof data.content !== 'string') return null;
      const text = Buffer.from(data.content.replace(/\s/g, ''), 'base64').toString('utf8');
      return { text, sha: data.sha, json: () => JSON.parse(text) };
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  return {
    mode: 'github',
    owner,
    repo,
    branch,
    async getHead() {
      const data = await githubJson(`${repoPath}/git/ref/heads/${encodeURIComponent(branch)}`, { token });
      return data.object.sha;
    },
    async readLanguages(ref = branch) {
      const file = await readFileAt(`${LOCALES_DIR}/languages.json`, ref);
      if (!file) throw new Error('languages.json not found');
      return file.json();
    },
    async readSource() {
      return fetchGithubSource({ token });
    },
    async listPending(ref = branch) {
      const data = await githubJson(`${repoPath}/git/trees/${encodeURIComponent(ref)}?recursive=1`, { token });
      if (data.truncated) throw new Error('Git tree response is truncated; cannot enumerate pending submissions');
      return (data.tree || [])
        .filter((entry) => entry.type === 'blob'
          && entry.path.startsWith(`${SUBMISSIONS_DIR}/`)
          && entry.path.split('/').length === 3
          && entry.path.endsWith('.json'))
        .map((entry) => {
          const parts = entry.path.split('/');
          return { lang: parts[1], id: parts[2].slice(0, -5) };
        })
        .filter((x) => ID_RE.test(x.id)
          && !RESERVED_SUBMISSION_DIRS.has(x.lang)
          && x.lang.toLowerCase() !== SOURCE_LANG)
        .sort((a, b) => a.id.localeCompare(b.id));
    },
    async readSubmissionText(lang, id, ref = branch) {
      const file = await readFileAt(`${SUBMISSIONS_DIR}/${lang}/${id}.json`, ref, { raw: true });
      if (!file) {
        const err = new Error('Submission file not found');
        err.status = 404;
        throw err;
      }
      return file.text;
    },
    async readSubmission(lang, id, ref = branch) {
      const file = await readFileAt(`${SUBMISSIONS_DIR}/${lang}/${id}.json`, ref);
      if (!file) throw new Error('Submission file not found');
      return file.json();
    },
    async readTarget(lang, ns, ref = branch) {
      const file = await readFileAt(`${LOCALES_DIR}/${lang}/${ns}.json`, ref, { raw: true });
      return file ? file.json() : null;
    },
    async readMeta(lang, ref = branch) {
      const file = await readFileAt(`${LOCALES_DIR}/${lang}/${META_FILE}`, ref);
      return file ? file.json() : null;
    },
    async hasProcessed(id) {
      if (!ID_RE.test(id)) throw new Error('Invalid submission id');
      try {
        await githubJson(`${repoPath}/contents/${RESULTS_DIR}/${id}.json?ref=${encodeURIComponent(branch)}`, { token });
        return true;
      } catch (err) {
        if (err.status === 404) return false;
        throw err;
      }
    },
    async commit({ files, deletions, expectedHead, message }) {
      const additions = (files || []).map(({ path: rel, content }) => ({
        path: rel,
        contents: Buffer.from(content, 'utf8').toString('base64'),
      }));
      const input = {
        branch: { repositoryNameWithOwner: `${owner}/${repo}`, branchName: branch },
        expectedHeadOid: expectedHead,
        message: { headline: message },
        fileChanges: {
          additions,
          deletions: (deletions || []).map((path) => ({ path })),
        },
      };
      const mutation = `mutation ($input: CreateCommitOnBranchInput!) {
        createCommitOnBranch(input: $input) { commit { oid url } }
      }`;
      try {
        const data = await githubGraphql(mutation, { input }, { token });
        return data.createCommitOnBranch.commit;
      } catch (err) {
        if (isHeadMismatch(err)) {
          const actual = await this.getHead().catch(() => 'unknown');
          throw new HeadChangedError(expectedHead, actual);
        }
        throw err;
      }
    },
  };
}

function isHeadMismatch(err) {
  const text = `${err.message || ''} ${err.type || ''} ${JSON.stringify(err.graphqlErrors || [])}`.toLowerCase();
  return text.includes('expectedheadoid')
    || text.includes('expected head')
    || text.includes('not the current head')
    || text.includes('expected branch to point to')
    || text.includes('staledata')
    || text.includes('stale data');
}

/** Build the archive document for a processed submission. */
export function archiveDocument(payload, result) {
  const submission = typeof payload === 'string' ? { raw: payload } : toPlain(payload);
  return `${JSON.stringify({ submission, result: toPlain(result) }, null, 2)}\n`;
}



/**
 * Minimal GitHub HTTP client with bounded retries for transient failures.
 * All credentials come from the caller (CI secret); nothing is logged.
 */
import { API_RETRIES, API_RETRY_BASE_MS, API_TIMEOUT_MS } from './constants.js';

const API_ROOT = process.env.GITHUB_API_URL || 'https://api.github.com';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status === 403 || status >= 500;
}

function isRateLimit403(response) {
  if (response.status !== 403) return false;
  const remaining = response.headers.get('x-ratelimit-remaining');
  if (remaining === '0') return true;
  return Boolean(response.headers.get('retry-after'));
}

/**
 * Perform a GitHub request.
 * @param {string} pathOrUrl - API path (starting with /) or absolute URL.
 */
export async function githubFetch(pathOrUrl, {
  token, method = 'GET', body, headers = {}, retries = API_RETRIES,
} = {}) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API_ROOT}${pathOrUrl}`;
  const requestHeaders = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'web-presence-locales-processor',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      if (isRetryableStatus(response.status) && (response.status !== 403 || isRateLimit403(response))) {
        if (attempt >= retries) {
          throw new Error(`GitHub request failed after ${retries + 1} attempts: HTTP ${response.status}`);
        }
        const retryAfter = Number(response.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : API_RETRY_BASE_MS * (2 ** attempt);
        lastError = new Error(`GitHub request failed with ${response.status}`);
        await sleep(delay);
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      if (attempt >= retries) break;
      await sleep(API_RETRY_BASE_MS * (2 ** attempt));
    }
  }
  throw new Error(`GitHub request failed after ${retries + 1} attempts: ${lastError?.message || 'unknown'}`);
}

export async function githubJson(pathOrUrl, options = {}) {
  const response = await githubFetch(pathOrUrl, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = data?.message || text?.slice(0, 200) || response.statusText;
    const err = new Error(`GitHub API ${response.status}: ${message}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** GraphQL request (used for atomic compare-and-swap commits). */
export async function githubGraphql(query, variables, { token, retries = API_RETRIES } = {}) {
  const response = await githubFetch('/graphql', {
    token,
    method: 'POST',
    body: { query, variables },
    retries,
  });
  const data = await response.json();
  if (!response.ok || data.errors?.length) {
    const err = new Error(data.errors?.map((e) => e.message).join('; ') || `GraphQL failed: ${response.status}`);
    err.status = response.status;
    err.graphqlErrors = data.errors;
    throw err;
  }
  return data.data;
}

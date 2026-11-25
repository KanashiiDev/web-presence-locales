/**
 * Check-run rollup for auto-merge.
 *
 * GitHub's `filter=latest` de-duplicates re-run attempts inside one check
 * suite, but a manual re-run can create a *new* suite on the same SHA. The old
 * failing run is still returned. We therefore keep the run with the highest
 * numeric id per (app.id, name) and judge only those.
 */

const GREEN_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);

export function latestCheckRuns(runs) {
  const latest = new Map();
  for (const run of Array.isArray(runs) ? runs : []) {
    if (!run || typeof run !== 'object') continue;
    const appId = run.app?.id ?? '';
    const key = `${appId}::${run.name ?? ''}`;
    const previous = latest.get(key);
    if (!previous || Number(run.id || 0) > Number(previous.id || 0)) {
      latest.set(key, run);
    }
  }
  return [...latest.values()];
}

/** Split a stream of concatenated JSON documents (as emitted by gh --paginate). */
export function parseJsonStream(text) {
  const documents = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{' || char === '[') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        documents.push(JSON.parse(text.slice(start, index + 1)));
        start = -1;
      }
    }
  }
  if (depth !== 0 || inString) throw new Error('Truncated JSON document');
  return documents;
}

export function checkRunsVerdict(runs) {
  const latest = latestCheckRuns(runs);
  if (!latest.length) return { ok: false, reason: 'No check runs found', latest };
  const bad = latest.filter((run) => run.status !== 'completed' || !GREEN_CONCLUSIONS.has(run.conclusion));
  if (bad.length) {
    return {
      ok: false,
      latest,
      reason: bad.map((run) => `Check '${run.name}' is ${run.status}${run.conclusion ? ` (${run.conclusion})` : ''}`).join('; '),
    };
  }
  return { ok: true, latest, reason: `All ${latest.length} latest check runs are green` };
}

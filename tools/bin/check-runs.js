#!/usr/bin/env node
/** Read `gh api --paginate .../check-runs` documents from stdin, exit 0 if all latest runs are green. */
import { parseJsonStream, checkRunsVerdict } from '../lib/check-runs.js';

let text = '';
for await (const chunk of process.stdin) text += chunk;

let runs;
try {
  runs = parseJsonStream(text).flatMap((doc) => (Array.isArray(doc?.check_runs) ? doc.check_runs : []));
} catch (err) {
  console.error(`Could not parse check-run response: ${err.message}`);
  process.exit(2);
}

const verdict = checkRunsVerdict(runs);
console.log(verdict.reason);
if (!verdict.ok) process.exit(1);

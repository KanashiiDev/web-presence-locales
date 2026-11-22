#!/usr/bin/env node
/**
 * Local submission dry run. Exercises the exact processor pipeline against a
 * local checkout without touching the repository unless --apply is passed.
 *
 *   node tools/bin/dry-run.js
 *   node tools/bin/dry-run.js --apply
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalAdapter } from '../lib/adapters.js';
import { processSubmissions } from '../lib/processor.js';

const root = process.argv.includes('--root')
  ? path.resolve(process.argv[process.argv.indexOf('--root') + 1])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apply = process.argv.includes('--apply');
const adapter = createLocalAdapter(root);

if (!apply) {
  const pending = [];
  const dryAdapter = {
    ...adapter,
    commit: async (args) => {
      pending.push(args);
      return { oid: 'dry-run', message: args.message };
    },
  };
  const summary = await processSubmissions({ adapter: dryAdapter });
  console.log(JSON.stringify({ ...summary, simulatedCommits: pending }, null, 2));
  if (summary.results.some((r) => r.status === 'error' || r.status === 'rejected')) process.exitCode = 1;
} else {
  const summary = await processSubmissions({ adapter });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.results.some((r) => r.status === 'error')) process.exitCode = 1;
}

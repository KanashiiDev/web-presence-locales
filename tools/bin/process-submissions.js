#!/usr/bin/env node
/** Process all pending submissions against the live repository (CI only). */
import fs from 'node:fs/promises';
import { createGitHubAdapter } from '../lib/adapters.js';
import { processSubmissions } from '../lib/processor.js';

const adapter = createGitHubAdapter({ token: process.env.GITHUB_TOKEN });

const summary = await processSubmissions({ adapter });
const text = `${JSON.stringify(summary, null, 2)}\n`;
console.log(text);

/** Escape untrusted text before placing it in a Markdown table cell. */
function cell(value) {
  return String(value ?? '-').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    '## Submission processing',
    '',
    `- Pending: ${summary.pending}`,
    `- Processed: ${summary.processed}`,
    `- Skipped (already processed): ${summary.skipped}`,
    `- Source commit: ${summary.sourceCommit || 'local mirror'}`,
    '',
    '| Submission | Language | Status | Reason |',
    '|---|---|---|---|',
    ...summary.results.map((r) => `| ${cell(r.id)} | ${cell(r.lang)} | ${cell(r.status)} | ${cell(r.reason || r.message)} |`),
    '',
  ];
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
}

if (summary.results.some((r) => r.status === 'error')) process.exitCode = 1;

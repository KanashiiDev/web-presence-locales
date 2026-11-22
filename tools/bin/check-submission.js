#!/usr/bin/env node
/**
 * Validate submission files changed in a PR, without applying them.
 *
 *   node tools/bin/check-submission.js submissions/tr/<id>.json ...
 *
 * Schema, intake-path consistency and key-level QA are checked against the
 * local English mirror. Authoritative source freshness and three-way conflict
 * detection remain the processor's job.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fsp from 'node:fs/promises';
import { NAMESPACES, SUBMISSIONS_DIR } from '../lib/constants.js';
import { validateSubmission } from '../lib/submission.js';
import { teValidateKey } from '../lib/qa.js';
import { readLocalSource } from '../lib/source.js';
import { readLanguages } from '../lib/languages.js';
import { resolveWithin } from '../lib/fsutil.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: check-submission.js <submission.json> ...');
  process.exit(1);
}

const langs = await readLanguages(root);
const sourceState = await readLocalSource(root);
const report = { files: files.length, errors: [], warnings: [] };

for (const rel of files) {
  const match = /^submissions\/([a-z]{2,3}(?:-[a-z0-9]+)?)\/([A-Za-z0-9][A-Za-z0-9_-]{7,63})\.json$/.exec(rel.replace(/\\/g, '/'));
  if (!match) {
    report.errors.push(`${rel}: invalid intake path`);
    continue;
  }
  const [, dirLang, dirId] = match;
  let payload;
  try {
    payload = JSON.parse(await fsp.readFile(resolveWithin(root, rel), 'utf8'));
  } catch (err) {
    report.errors.push(`${rel}: invalid JSON: ${err.message}`);
    continue;
  }
  const validation = validateSubmission(payload, { langs, namespaces: NAMESPACES });
  if (!validation.ok) {
    report.errors.push(...validation.errors.map((message) => `${rel}: ${message}`));
    continue;
  }
  const submission = validation.value;
  if (submission.lang !== dirLang || submission.id !== dirId) {
    report.errors.push(`${rel}: payload lang/id (${submission.lang}/${submission.id}) does not match the path`);
    continue;
  }
  const source = sourceState.source[submission.ns];
  if (!source) {
    report.errors.push(`${rel}: unknown namespace ${submission.ns}`);
    continue;
  }
  for (const [key, change] of Object.entries(submission.changes)) {
    if (!(key in source)) {
      report.warnings.push(`${rel}: ${key} is not in the local English mirror`);
      continue;
    }
    const verdict = teValidateKey({ key, source: source[key], value: change.value });
    for (const entry of verdict.errors) report.errors.push(`${rel}: ${key}: ${entry.code}: ${entry.message}`);
    for (const entry of verdict.warnings) report.warnings.push(`${rel}: ${key}: ${entry.code}: ${entry.message}`);
  }
}

console.log(JSON.stringify(report, null, 2));
if (report.errors.length) process.exitCode = 1;

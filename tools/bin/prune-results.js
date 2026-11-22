#!/usr/bin/env node
/**
 * Optional retention tool for submissions/results and submissions/archive.
 * Processing writes both files for every submission, so they grow forever.
 *
 *   node tools/bin/prune-results.js --days 365         # dry run
 *   node tools/bin/prune-results.js --days 365 --apply # delete
 *
 * NOTE: deleting a result file removes the idempotency marker for that id, so
 * only prune entries older than a period after which a resubmission is safe.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESULTS_DIR, ARCHIVE_DIR } from '../lib/constants.js';
import { resolveWithin } from '../lib/fsutil.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const idx = process.argv.indexOf('--days');
const days = idx >= 0 ? Number(process.argv[idx + 1]) : 365;
const apply = process.argv.includes('--apply');
if (!Number.isFinite(days) || days <= 0) {
  console.error('--days must be a positive number');
  process.exit(1);
}

const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
const candidates = [];
for (const dir of [RESULTS_DIR, ARCHIVE_DIR]) {
  const base = resolveWithin(root, dir);
  let entries = [];
  try {
    entries = await fsp.readdir(base, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') continue;
    throw err;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      const file = path.join(base, entry.name);
      const stat = await fsp.stat(file);
      if (stat.mtimeMs < cutoff) candidates.push({ file, mtime: stat.mtimeMs });
    } else if (entry.isDirectory()) {
      for (const id of await fsp.readdir(path.join(base, entry.name))) {
        if (!id.endsWith('.json')) continue;
        const file = path.join(base, entry.name, id);
        const stat = await fsp.stat(file);
        if (stat.mtimeMs < cutoff) candidates.push({ file, mtime: stat.mtimeMs });
      }
    }
  }
}

if (apply) {
  await Promise.all(candidates.map((c) => fsp.unlink(c.file)));
}
console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  days,
  removed: candidates.length,
  files: candidates.map((c) => path.relative(root, c.file).replace(/\\/g, '/')),
}, null, 2));

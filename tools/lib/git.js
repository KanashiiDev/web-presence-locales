import { execFileSync } from 'node:child_process';

/** Read the current commit SHA of a local checkout. */
export function localHead(root) {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

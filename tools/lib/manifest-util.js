import { localHead } from './git.js';

export function localHeadSafe(root) {
  try {
    return localHead(root);
  } catch {
    return '0'.repeat(40);
  }
}

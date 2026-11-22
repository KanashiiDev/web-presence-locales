import { LOCALES_DIR, LANGUAGES_FILE } from './constants.js';
import { resolveWithin, readJson } from './fsutil.js';

export async function readLanguages(root) {
  return readJson(resolveWithin(root, LOCALES_DIR, LANGUAGES_FILE));
}

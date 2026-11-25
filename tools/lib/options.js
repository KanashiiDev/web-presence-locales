/** Resolve the optional orphan-cleanup flag from a workflow/script environment value. */
export function cleanupOrphansEnabled(raw) {
  if (raw === undefined || raw === null || raw === '' || raw === 'null') return true;
  return String(raw).toLowerCase() !== 'false';
}

/**
 * Parse a raw flag coming from either `toJSON(client_payload.cleanup_orphans)`
 * (a JSON literal such as `false`, `true` or `null`) or a workflow input string.
 * Returns undefined when the value carries no explicit decision.
 */
export function parseCleanupFlag(raw) {
  if (raw === undefined || raw === null || raw === '' || raw === 'null') return undefined;
  if (raw === true || raw === false) return raw;
  const text = String(raw).toLowerCase();
  if (text === 'true') return true;
  if (text === 'false') return false;
  return undefined;
}

/**
 * Precedence: repository_dispatch payload (raw JSON, may be boolean false)
 * wins over workflow_dispatch input. Absent values fall back to cleanup=true.
 */
export function resolveCleanupOrphans(dispatchRaw, inputRaw) {
  const dispatch = parseCleanupFlag(dispatchRaw);
  if (dispatch !== undefined) return dispatch;
  const input = parseCleanupFlag(inputRaw);
  if (input !== undefined) return input;
  return true;
}

/**
 * Idempotency Layer with TTL
 *
 * Purpose:
 * - Support at-least-once delivery by providing a simple in-memory deduplication helper.
 * - Call markIfSeen(dedupeKey) before performing side-effects; if it returns true, skip work.
 *
 * Notes for LLM agents:
 * - This in-memory store is process-local and suitable for single-instance dev/test.
 * - For production, consider replacing with a distributed store (e.g., Redis, Firestore) keyed by correlationId + step + attempt.
 */

/** Time-to-live for dedupe entries, in milliseconds (default 5 minutes). */
const TTL_MS = Number(process.env.IDEMPOTENCY_TTL_MS || 5 * 60 * 1000);

/** Internal map of dedupeKey -> timestamp (ms since epoch). */
const SEEN = new Map<string, number>();

/**
 * Opportunistic sweep to evict expired entries when the map grows.
 * Keeps overhead low by sweeping only when the map is reasonably large.
 */
function sweep(now: number) {
  if (SEEN.size < 1000) return;
  for (const [k, ts] of SEEN.entries()) if (now - ts > TTL_MS) SEEN.delete(k);
}

/**
 * Mark a key as seen and return whether it was already present (within TTL).
 *
 * @param key - A deterministic idempotency key, e.g., `${correlationId}|${stepId}|${attempt}`
 * @returns true if the key was already present (duplicate), false otherwise.
 */
export function markIfSeen(key: string): boolean {
  const now = Date.now();
  sweep(now);
  if (SEEN.has(key)) return true;
  SEEN.set(key, now);
  return false;
}

/** Reset in-memory state for tests. */
export function _resetForTests() {
  SEEN.clear();
}

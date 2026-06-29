/**
 * Consumer-side idempotency dedupe (per-process, in-memory).
 *
 * Purpose:
 * - Delivery is at-least-once (messaging.transport.delivery). A slow Bit (e.g. image-gen-mcp,
 *   llm-bot) whose processing approaches the ack deadline can have its message redelivered while
 *   (or just after) the first attempt is still producing an egress, yielding a DUPLICATE response.
 * - This module provides a transport-agnostic guard so a redelivery of the SAME logical message is
 *   dropped before the handler runs a second time.
 *
 * Dedupe key (canonical, per architecture.yaml invariant "dedupe on correlationId + step + attempt"):
 *   1. explicit idempotencyKey attribute, else
 *   2. `${correlationId}::${step}::${attempt}` when a correlationId attribute is present, else
 *   3. a transport-provided fallback id (e.g. Pub/Sub message.id or NATS stream sequence) so that
 *      messages WITHOUT correlation attributes are still protected against redelivery.
 *
 * Notes for LLM agents:
 * - This is a single-process cache. Cross-instance dedupe (multiple replicas) is intentionally out of
 *   scope here; see the deferred persistent dedupe store. The transport ack-deadline/lease extension
 *   is the primary mechanism that prevents redelivery in the first place; this is the safety net.
 */

export type DedupeAttrs = Record<string, unknown> | undefined;

/** Whether dedupe is disabled via env. */
export function isDedupeDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MESSAGE_DEDUP_DISABLE || '').toLowerCase() === '1';
}

/** TTL (ms) for a dedupe entry. Default 10 minutes. */
export function getDedupeTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.MESSAGE_DEDUP_TTL_MS || '600000');
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 600000;
}

/** Maximum number of dedupe entries kept in memory. Default 5000. */
export function getDedupeMax(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.MESSAGE_DEDUP_MAX || '5000');
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5000;
}

/** Case-insensitive attribute lookup over a list of candidate names. */
function pick(attrs: DedupeAttrs, names: string[]): string | undefined {
  if (!attrs) return undefined;
  for (const name of names) {
    const v = (attrs as any)[name];
    if (v != null && String(v).length > 0) return String(v);
  }
  return undefined;
}

/**
 * Build the canonical dedupe key for a message.
 *
 * @param attrs       message attributes/headers
 * @param fallbackId  transport message id (Pub/Sub message.id, NATS sequence). Used when no
 *                    idempotencyKey/correlationId is present so redelivery is still caught.
 * @returns a stable string key, or '' when nothing identifying is available.
 */
export function buildDedupeKey(attrs: DedupeAttrs, fallbackId?: string | number | null): string {
  const idempotencyKey = pick(attrs, [
    'idempotencyKey', 'IdempotencyKey', 'idempotency-key', 'Idempotency-Key',
  ]);
  if (idempotencyKey) return idempotencyKey;

  const correlationId = pick(attrs, [
    'correlationId', 'CorrelationId', 'correlation-id', 'Correlation-Id',
  ]);
  if (correlationId) {
    const step = pick(attrs, ['step', 'Step']) ?? '';
    const attempt = pick(attrs, ['attempt', 'Attempt']) ?? '';
    return `${correlationId}::${step}::${attempt}`;
  }

  if (fallbackId != null && String(fallbackId).length > 0) {
    return `id:${String(fallbackId)}`;
  }
  return '';
}

const store = {
  map: new Map<string, number>(),
  lastPrune: 0,
};

/** Reset the in-memory dedupe store (test helper). */
export function __resetDedupe(): void {
  store.map.clear();
  store.lastPrune = 0;
}

/**
 * Record the key and report whether this delivery is a duplicate that should be dropped.
 * Returns true when a previous (non-expired) delivery for the same key was seen.
 */
export function dedupeShouldDrop(key: string, now: number = Date.now(), env: NodeJS.ProcessEnv = process.env): boolean {
  if (!key) return false;
  const ttl = getDedupeTtlMs(env);
  const max = getDedupeMax(env);

  // Prune periodically or when size exceeds max.
  if (store.map.size > max || now - store.lastPrune > Math.min(ttl, 30000)) {
    for (const [k, ts] of store.map) {
      if (now - ts > ttl) store.map.delete(k);
    }
    if (store.map.size > max) {
      const target = Math.floor(max * 0.9);
      const it = store.map.keys();
      while (store.map.size > target) {
        const next = it.next();
        if (next.done) break;
        store.map.delete(next.value);
      }
    }
    store.lastPrune = now;
  }

  const prev = store.map.get(key);
  if (prev && now - prev <= ttl) {
    // Refresh timestamp to extend the dedupe window and drop the redelivery.
    store.map.set(key, now);
    return true;
  }
  store.map.set(key, now);
  return false;
}

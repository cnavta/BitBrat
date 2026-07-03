import { buildDedupeKey, dedupeShouldDrop, __resetDedupe } from '../dedupe';

describe('buildDedupeKey – canonical idempotency key', () => {
  it('prefers an explicit idempotencyKey attribute', () => {
    expect(buildDedupeKey({ idempotencyKey: 'abc', correlationId: 'X' }, 'm1')).toBe('abc');
    expect(buildDedupeKey({ 'Idempotency-Key': 'abc' }, 'm1')).toBe('abc');
  });

  it('uses correlationId + step + attempt when present (architecture invariant)', () => {
    expect(buildDedupeKey({ correlationId: 'X', step: 'respond', attempt: '1' }, 'm1')).toBe('X::respond::1');
    // distinct steps of the same correlation are NOT collapsed
    expect(buildDedupeKey({ correlationId: 'X', step: 'a' }, 'm1')).not.toBe(
      buildDedupeKey({ correlationId: 'X', step: 'b' }, 'm2'),
    );
  });

  it('falls back to transport message id when no correlation attributes exist', () => {
    expect(buildDedupeKey({}, 'msg-123')).toBe('id:msg-123');
    expect(buildDedupeKey(undefined, 42)).toBe('id:42');
  });

  it('returns empty string when nothing identifies the message', () => {
    expect(buildDedupeKey({}, null)).toBe('');
  });
});

describe('dedupeShouldDrop – redelivery protection', () => {
  beforeEach(() => __resetDedupe());

  it('passes the first delivery and drops a redelivery within TTL', () => {
    const key = 'X::respond::1';
    expect(dedupeShouldDrop(key, 1000)).toBe(false); // first time
    expect(dedupeShouldDrop(key, 1500)).toBe(true);  // redelivery
  });

  it('allows the same key again after the TTL window elapses', () => {
    const env = { MESSAGE_DEDUP_TTL_MS: '100' } as any;
    expect(dedupeShouldDrop('k', 1000, env)).toBe(false);
    expect(dedupeShouldDrop('k', 1050, env)).toBe(true);
    expect(dedupeShouldDrop('k', 5000, env)).toBe(false); // expired -> treated as new
  });

  it('never drops an empty key', () => {
    expect(dedupeShouldDrop('', 1000)).toBe(false);
    expect(dedupeShouldDrop('', 2000)).toBe(false);
  });
});

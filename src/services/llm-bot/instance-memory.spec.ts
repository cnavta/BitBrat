import { InstanceMemoryStore, type ChatMessage } from './instance-memory';

function msg(role: 'system'|'user'|'assistant', content: string): ChatMessage {
  return { role, content, createdAt: new Date().toISOString() };
}

describe('InstanceMemoryStore', () => {
  test('appends and trims by message count keeping last N', async () => {
    const store = new InstanceMemoryStore({ maxKeys: 1000, maxMessagesPerKey: 2, maxCharsPerKey: 1000, ttlMs: 60_000 });
    const key = 'k1';
    await store.append(key, [msg('user', 'one')]);
    await store.append(key, [msg('assistant', 'two')]);
    await store.append(key, [msg('user', 'three')]);
    const out = await store.read(key);
    expect(out.map(m => m.content)).toEqual(['two', 'three']);
  });

  test('trims by chars dropping oldest until under limit', async () => {
    const store = new InstanceMemoryStore({ maxKeys: 1000, maxMessagesPerKey: 100, maxCharsPerKey: 5, ttlMs: 60_000 });
    const key = 'k2';
    await store.append(key, [msg('user', 'abcdef')]);
    await store.append(key, [msg('user', 'xy')]);
    const out = await store.read(key);
    expect(out.map(m => m.content)).toEqual(['xy']);
  });

  test('TTL eviction removes stale keys', async () => {
    const store = new InstanceMemoryStore({ maxKeys: 1000, maxMessagesPerKey: 10, maxCharsPerKey: 1000, ttlMs: 1 });
    const key = 'k3';
    await store.append(key, [msg('user', 'hi')]);
    await new Promise((r) => setTimeout(r, 5));
    const out = await store.read(key);
    expect(out.length).toBe(0);
  });

  test('LRU eviction when maxKeys exceeded', async () => {
    const store = new InstanceMemoryStore({ maxKeys: 2, maxMessagesPerKey: 10, maxCharsPerKey: 1000, ttlMs: 60_000 });
    await store.append('a', [msg('user', 'a')]);
    await store.append('b', [msg('user', 'b')]);
    await store.append('c', [msg('user', 'c')]); // should evict the oldest (a)
    const ra = await store.read('a');
    const rb = await store.read('b');
    const rc = await store.read('c');
    expect(ra.length).toBe(0);
    expect(rb.length).toBe(1);
    expect(rc.length).toBe(1);
  });

  test('concurrent appends serialize per key', async () => {
    const store = new InstanceMemoryStore({ maxKeys: 1000, maxMessagesPerKey: 10, maxCharsPerKey: 1000, ttlMs: 60_000 });
    const key = 'k4';
    const p1 = store.append(key, [msg('user', 'one')]);
    const p2 = store.append(key, [msg('user', 'two')]);
    await Promise.all([p1, p2]);
    const out = await store.read(key);
    // Expect both in some order, but due to per-key lock the order should be append order
    expect(out.map(m => m.content)).toEqual(['one', 'two']);
  });
});

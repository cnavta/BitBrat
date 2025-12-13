import { resolvePersonalityParts, type ResolvedPersonality } from '../personality-resolver';
import type { AnnotationV1 } from '../../../types/events';

function ann(payload: any, createdAt = '2024-01-01T00:00:00Z'): AnnotationV1 {
  return {
    id: Math.random().toString(36).slice(2),
    kind: 'personality',
    source: 'test',
    createdAt,
    payload,
  } as any;
}

describe('resolvePersonalityParts', () => {
  const opts = { maxAnnotations: 3, maxChars: 100, cacheTtlMs: 60_000 };

  it('returns empty when no personality annotations present', async () => {
    const res = await resolvePersonalityParts([], opts, {});
    expect(res).toEqual([]);
  });

  it('prefers inline text and clamps/sanitizes', async () => {
    const res = await resolvePersonalityParts([
      ann({ name: 'foo', text: '  Hello World  ' }),
    ], { ...opts, maxChars: 5 }, {});
    expect(res.length).toBe(1);
    expect(res[0].source).toBe('inline');
    expect(res[0].text).toBe('Hello'); // clamped to 5 chars
  });

  it('fetches by name when no inline text', async () => {
    const fetchByName = jest.fn(async (name: string) => ({ name, text: 'From DB', status: 'active', version: 2 } as any));
    const res = await resolvePersonalityParts([
      ann({ name: 'db-only' })
    ], opts, { fetchByName });
    expect(fetchByName).toHaveBeenCalledWith('db-only');
    expect(res.length).toBe(1);
    expect(res[0]).toMatchObject({ text: 'From DB', source: 'firestore', version: 2 });
  });

  it('ignores inactive docs', async () => {
    const fetchByName = jest.fn(async () => ({ name: 'x', text: 'nope', status: 'inactive', version: 1 } as any));
    const res = await resolvePersonalityParts([ann({ name: 'x' })], opts, { fetchByName });
    expect(res.length).toBe(0);
  });

  it('caches results by name within TTL', async () => {
    const fetchByName = jest.fn(async () => ({ name: 'y', text: 'cached', status: 'active', version: 3 } as any));
    const annotations = [ann({ name: 'y' })];
    const r1 = await resolvePersonalityParts(annotations, { ...opts, cacheTtlMs: 300_000 }, { fetchByName });
    const r2 = await resolvePersonalityParts(annotations, { ...opts, cacheTtlMs: 300_000 }, { fetchByName });
    expect(fetchByName).toHaveBeenCalledTimes(1);
    expect(r1[0].text).toBe('cached');
    expect(r2[0].text).toBe('cached');
  });
});

import { resolvePersonalityParts } from '../personality-resolver';
import type { AnnotationV1 } from '../../../types/events';

function ann(payload: any, score: number | undefined, createdAt: string, id: string): AnnotationV1 {
  return {
    id,
    kind: 'personality',
    source: 'test',
    createdAt,
    score,
    payload,
  } as any;
}

describe('resolvePersonalityParts – sorting by score ascending', () => {
  const opts = { maxAnnotations: 10, maxChars: 1000, cacheTtlMs: 0 };

  it('orders personalities by score asc; undefined scores come last; ties by createdAt then id', async () => {
    const anns: AnnotationV1[] = [
      ann({ text: 'A' }, 0.2, '2025-01-02T00:00:00Z', 'a'),
      ann({ text: 'B' }, 0.1, '2025-01-03T00:00:00Z', 'b'),
      ann({ text: 'C' }, undefined, '2025-01-01T00:00:00Z', 'c'),
      // tie on score, createdAt decides
      ann({ text: 'D' }, 0.1, '2025-01-01T00:00:00Z', 'd'),
      // tie on score and createdAt, id decides
      ann({ text: 'E' }, 0.1, '2025-01-01T00:00:00Z', 'e'),
    ];

    const parts = await resolvePersonalityParts(anns, opts, {});
    const texts = parts.map((p) => p.text);
    // Expected order: D (0.1, earlier), E (0.1, same time, id d<e), B (0.1 later), A (0.2), C (undefined)
    expect(texts).toEqual(['D', 'E', 'B', 'A', 'C']);
  });
});

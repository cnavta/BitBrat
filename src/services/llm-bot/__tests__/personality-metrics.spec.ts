import { resolvePersonalityParts } from '../personality-resolver';
import type { AnnotationV1 } from '../../../types/events';
import { metrics,
  METRIC_PERSONALITIES_RESOLVED,
  METRIC_PERSONALITIES_FAILED,
  METRIC_PERSONALITIES_DROPPED,
  METRIC_PERSONALITY_CACHE_HIT,
  METRIC_PERSONALITY_CACHE_MISS,
  METRIC_PERSONALITY_CLAMPED,
} from '../../../common/metrics';

function ann(payload: any, createdAt = '2024-01-01T00:00:00Z'): AnnotationV1 {
  return {
    id: Math.random().toString(36).slice(2),
    kind: 'personality',
    source: 'test',
    createdAt,
    payload,
  } as any;
}

describe('PersonalityResolver metrics', () => {
  const baseOpts = { maxAnnotations: 3, maxChars: 100, cacheTtlMs: 120_000 };

  beforeEach(() => {
    metrics.resetAll();
  });

  it('increments resolved and clamped for inline personalities exceeding maxChars', async () => {
    const res = await resolvePersonalityParts([
      ann({ text: 'abcdef' }),
    ], { ...baseOpts, maxChars: 3 }, {});
    expect(res.length).toBe(1);
    expect(metrics.get(METRIC_PERSONALITIES_RESOLVED)).toBe(1);
    expect(metrics.get(METRIC_PERSONALITY_CLAMPED)).toBe(1);
    expect(metrics.get(METRIC_PERSONALITY_CACHE_HIT)).toBe(0);
    expect(metrics.get(METRIC_PERSONALITY_CACHE_MISS)).toBe(0);
    expect(metrics.get(METRIC_PERSONALITIES_FAILED)).toBe(0);
  });

  it('tracks cache miss on first fetch and cache hit on subsequent fetch within TTL', async () => {
    const fetchByName = jest.fn(async (name: string) => ({ name, text: 'DB', status: 'active', version: 1 } as any));
    const annotations = [ann({ name: 'p' })];
    await resolvePersonalityParts(annotations, baseOpts, { fetchByName });
    expect(metrics.get(METRIC_PERSONALITY_CACHE_MISS)).toBe(1);
    expect(metrics.get(METRIC_PERSONALITIES_RESOLVED)).toBe(1);
    await resolvePersonalityParts(annotations, baseOpts, { fetchByName });
    expect(metrics.get(METRIC_PERSONALITY_CACHE_HIT)).toBe(1);
    expect(metrics.get(METRIC_PERSONALITIES_RESOLVED)).toBe(2);
    expect(fetchByName).toHaveBeenCalledTimes(1);
  });

  it('increments failed when doc is inactive', async () => {
    const fetchByName = jest.fn(async () => ({ name: 'x', text: 'X', status: 'inactive', version: 1 } as any));
    const res = await resolvePersonalityParts([ann({ name: 'x' })], baseOpts, { fetchByName });
    expect(res.length).toBe(0);
    expect(metrics.get(METRIC_PERSONALITIES_FAILED)).toBe(1);
    expect(metrics.get(METRIC_PERSONALITIES_RESOLVED)).toBe(0);
  });

  it('counts dropped personalities when exceeding maxAnnotations', async () => {
    const annotations = [
      ann({ text: 'A' }, '2024-01-01T00:00:00Z'),
      ann({ text: 'B' }, '2024-01-01T00:00:01Z'),
      ann({ text: 'C' }, '2024-01-01T00:00:02Z'),
      ann({ text: 'D' }, '2024-01-01T00:00:03Z'),
      ann({ text: 'E' }, '2024-01-01T00:00:04Z'),
    ];
    const res = await resolvePersonalityParts(annotations, { ...baseOpts, maxAnnotations: 2 }, {});
    expect(res.length).toBe(2);
    expect(metrics.get(METRIC_PERSONALITIES_DROPPED)).toBe(3);
    expect(metrics.get(METRIC_PERSONALITIES_RESOLVED)).toBe(2);
  });

  it('increments failed when fetchByName is unavailable and no inline text', async () => {
    const res = await resolvePersonalityParts([ann({ name: 'no-driver' })], baseOpts, {});
    expect(res.length).toBe(0);
    expect(metrics.get(METRIC_PERSONALITIES_FAILED)).toBe(1);
  });
});

import { resolvePersonalityParts } from './personality-resolver';
import type { AnnotationV1 } from '../../types/events';

describe('resolvePersonalityParts short format', () => {
  const opts = { maxAnnotations: 3, maxChars: 100, cacheTtlMs: 60_000 };

  it('recognizes short format {"id":"a1","kind":"personality","value":"bitbrat_the_ai"}', async () => {
    const fetchByName = jest.fn(async (name: string) => {
      if (name === 'bitbrat_the_ai') {
        return { name, text: 'Resolved from DB', status: 'active' } as any;
      }
      return undefined;
    });

    const annotations: AnnotationV1[] = [
      {
        id: 'a1',
        kind: 'personality',
        source: 'test',
        createdAt: new Date().toISOString(),
        value: 'bitbrat_the_ai'
      } as any
    ];

    const res = await resolvePersonalityParts(annotations, opts, { fetchByName });
    
    // CURRENT FAILURE: It probably treats 'bitbrat_the_ai' as inline text because 'value' is present.
    // So source would be 'inline' and text would be 'bitbrat_the_ai'.
    // If we want it to resolve, we expect:
    expect(res.length).toBe(1);
    expect(res[0].source).toBe('firestore');
    expect(res[0].text).toBe('Resolved from DB');
    expect(fetchByName).toHaveBeenCalledWith('bitbrat_the_ai');
  });
});

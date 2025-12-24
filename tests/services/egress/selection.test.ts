import { selectBestCandidate, extractEgressTextFromEvent } from '../../../src/common/events/selection';
import { CandidateV1, InternalEventV2 } from '../../../src/types/events';

describe('egress selection', () => {
  test('selectBestCandidate returns null for empty or invalid', () => {
    expect(selectBestCandidate(undefined)).toBeNull();
    expect(selectBestCandidate(null as any)).toBeNull();
    expect(selectBestCandidate([])).toBeNull();
  });

  test('selects lowest priority', () => {
    const candidates: CandidateV1[] = [
      { id: 'a', kind: 'text', source: 'svc', createdAt: '2025-01-01T00:00:00Z', status: 'proposed', priority: 10, text: 'A' },
      { id: 'b', kind: 'text', source: 'svc', createdAt: '2025-01-01T00:00:00Z', status: 'proposed', priority: 1, text: 'B' },
      { id: 'c', kind: 'text', source: 'svc', createdAt: '2025-01-01T00:00:00Z', status: 'proposed', priority: 5, text: 'C' },
    ];
    const best = selectBestCandidate(candidates)!;
    expect(best.id).toBe('b');
  });

  test('tie-breaker by higher confidence, then earliest createdAt', () => {
    const candidates: CandidateV1[] = [
      { id: 'a', kind: 'text', source: 'svc', createdAt: '2025-01-02T00:00:00Z', status: 'proposed', priority: 5, confidence: 0.7, text: 'A' },
      { id: 'b', kind: 'text', source: 'svc', createdAt: '2025-01-01T00:00:00Z', status: 'proposed', priority: 5, confidence: 0.8, text: 'B' },
      { id: 'c', kind: 'text', source: 'svc', createdAt: '2025-01-01T12:00:00Z', status: 'proposed', priority: 5, confidence: 0.8, text: 'C' },
    ];
    const best = selectBestCandidate(candidates)!;
    // b and c tie on priority and confidence; b is earlier createdAt
    expect(best.id).toBe('b');
  });

  test('extractEgressTextFromEvent prefers V2 candidates then legacy payload', () => {
    const evt: InternalEventV2 = {
      v: '1',
      source: 'test',
      correlationId: 'corr-1',
      type: 'egress.deliver.v1',
      message: { id: 'm1', role: 'assistant', text: 'ignored' },
      candidates: [
        { id: 'x', kind: 'text', source: 'svc', createdAt: '2025-01-01T00:00:00Z', status: 'proposed', priority: 1, text: 'hello world' },
      ],
    };
    expect(extractEgressTextFromEvent(evt)).toBe('hello world');

    const legacy: any = { payload: { text: 'legacy text' } };
    expect(extractEgressTextFromEvent(legacy)).toBe('legacy text');
  });

  test('extractEgressTextFromEvent unwraps surrounding quotes from candidate text', () => {
    const evt: any = {
      candidates: [
        { id: 'q', kind: 'text', source: 'svc', createdAt: '2025-01-01T00:00:00Z', status: 'proposed', priority: 1, text: '"Hello there"' },
      ],
    };
    expect(extractEgressTextFromEvent(evt)).toBe('Hello there');
  });

  test('extractEgressTextFromEvent unwraps quotes for legacy payloads', () => {
    const legacy1: any = { message: { rawPlatformPayload: { text: '"Hi Twitch"' } } };
    expect(extractEgressTextFromEvent(legacy1)).toBe('Hi Twitch');
    const legacy2: any = { payload: { text: '“Quoted smart”' } };
    expect(extractEgressTextFromEvent(legacy2)).toBe('Quoted smart');
  });
});

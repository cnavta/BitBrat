import { extractEgressTextFromEvent, selectBestCandidate } from './selection';
import { CandidateV1 } from '../../types/events';

// Helper to create test candidates with required fields
function createCandidate(overrides: Partial<CandidateV1>): CandidateV1 {
  return {
    id: 'test-id',
    kind: 'text',
    source: 'test',
    status: 'proposed',
    priority: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('selectBestCandidate', () => {
  it('returns null for empty array', () => {
    expect(selectBestCandidate([])).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(selectBestCandidate(undefined)).toBeNull();
  });

  it('returns null for null', () => {
    expect(selectBestCandidate(null)).toBeNull();
  });

  it('returns single candidate', () => {
    const candidates: CandidateV1[] = [
      createCandidate({ id: 'c1', text: 'Hello' }),
    ];
    expect(selectBestCandidate(candidates)).toEqual(candidates[0]);
  });

  it('selects candidate with lowest priority', () => {
    const candidates: CandidateV1[] = [
      createCandidate({ id: 'c1', text: 'Priority 10', priority: 10 }),
      createCandidate({ id: 'c2', text: 'Priority 0', priority: 0 }),
      createCandidate({ id: 'c3', text: 'Priority 5', priority: 5 }),
    ];
    const best = selectBestCandidate(candidates);
    expect(best?.id).toBe('c2');
  });

  it('selects candidate with highest confidence when priorities are equal', () => {
    const candidates: CandidateV1[] = [
      createCandidate({ id: 'c1', text: 'Confidence 0.5', priority: 0, confidence: 0.5 }),
      createCandidate({ id: 'c2', text: 'Confidence 0.9', priority: 0, confidence: 0.9 }),
      createCandidate({ id: 'c3', text: 'Confidence 0.7', priority: 0, confidence: 0.7 }),
    ];
    const best = selectBestCandidate(candidates);
    expect(best?.id).toBe('c2');
  });

  it('randomizes selection when priority and confidence are equal', () => {
    const candidates: CandidateV1[] = [
      createCandidate({ id: 'c1', text: 'First', priority: 0, confidence: 1.0 }),
      createCandidate({ id: 'c2', text: 'Second', priority: 0, confidence: 1.0 }),
      createCandidate({ id: 'c3', text: 'Third', priority: 0, confidence: 1.0 }),
    ];

    // Run selection multiple times and verify we get different results
    const results = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const best = selectBestCandidate(candidates);
      if (best) results.add(best.id);
    }

    // With random selection, we should see multiple different candidates selected
    // over 50 iterations (probability of only selecting one is astronomically low)
    expect(results.size).toBeGreaterThan(1);
  });

  it('treats undefined priority as lowest priority', () => {
    const c1 = createCandidate({ id: 'c1', text: 'No priority', confidence: 1.0 });
    delete (c1 as any).priority; // Remove priority field
    const candidates: CandidateV1[] = [
      c1,
      createCandidate({ id: 'c2', text: 'Priority 100', priority: 100, confidence: 1.0 }),
    ];
    const best = selectBestCandidate(candidates);
    expect(best?.id).toBe('c2'); // c2 has explicit priority 100, c1 is treated as Infinity
  });

  it('treats undefined confidence as lowest confidence', () => {
    const candidates: CandidateV1[] = [
      createCandidate({ id: 'c1', text: 'No confidence', priority: 0 }),
      createCandidate({ id: 'c2', text: 'Confidence 0.5', priority: 0, confidence: 0.5 }),
    ];
    const best = selectBestCandidate(candidates);
    expect(best?.id).toBe('c2'); // c2 has explicit confidence, c1 is treated as -1
  });

  it('respects priority over confidence', () => {
    const candidates: CandidateV1[] = [
      createCandidate({ id: 'c1', text: 'Low priority, high confidence', priority: 0, confidence: 0.5 }),
      createCandidate({ id: 'c2', text: 'High priority, low confidence', priority: 10, confidence: 1.0 }),
    ];
    const best = selectBestCandidate(candidates);
    expect(best?.id).toBe('c1'); // Lower priority (0) wins over higher confidence
  });
});

describe('extractEgressTextFromEvent', () => {
  it('returns null if candidates array is empty', () => {
    const evt = {
      candidates: []
    };
    expect(extractEgressTextFromEvent(evt)).toBeNull();
  });

  it('falls back to legacy message if candidates is missing', () => {
    const evt = {
      message: {
        rawPlatformPayload: {
          text: 'original message'
        }
      }
    };
    // This is the current behavior we might want to change for egress
    expect(extractEgressTextFromEvent(evt)).toBe('original message');
  });

  it('returns null if candidates is missing and it is an egress event with a V2 message block', () => {
    const evt = {
      egress: { connector: 'twitch' },
      message: {
        rawPlatformPayload: {
          text: 'original message'
        }
      }
    };
    expect(extractEgressTextFromEvent(evt)).toBeNull();
  });

  it('falls back to payload.text if message is missing even if egress is present (hybrid/legacy test cases)', () => {
    const evt = {
      v: '2',
      egress: { destination: 'discord' },
      payload: { text: 'hybrid message' }
    };
    expect(extractEgressTextFromEvent(evt)).toBe('hybrid message');
  });

  it('falls back to payload.text for pure V1 legacy events', () => {
    const evt = {
      egress: { destination: 'discord' },
      payload: { text: 'legacy message' }
    };
    expect(extractEgressTextFromEvent(evt)).toBe('legacy message');
  });
});

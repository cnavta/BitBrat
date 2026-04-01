import { buildBehavioralGuidance, deriveBehaviorProfile, deriveToneBucket } from './behavior-profile';
import type { AnnotationV1 } from '../../types/events';

function annotation(overrides: Partial<AnnotationV1>): AnnotationV1 {
  return {
    id: 'ann-1',
    kind: 'custom',
    source: 'test',
    createdAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('behavior-profile', () => {
  test('defaults to neutral question behavior when annotations are missing', () => {
    const profile = deriveBehaviorProfile(undefined);

    expect(profile.intent).toBe('question');
    expect(profile.tone.bucket).toBe('neutral');
    expect(profile.risk).toEqual({ level: 'none', type: 'none' });
    expect(profile.responseMode).toBe('answer');
    expect(profile.policy.shouldRespond).toBe(true);
    expect(profile.policy.shouldUseTools).toBe(true);
    expect(profile.gate).toBe('PROCEED');
  });

  test('normalizes intent, tone, and risk annotations from a single extractor path', () => {
    const annotations: AnnotationV1[] = [
      annotation({ kind: 'intent', value: 'critique', label: 'critique' }),
      annotation({ kind: 'tone', payload: { valence: -0.85, arousal: 0.92 } }),
      annotation({ kind: 'risk', label: 'med', payload: { level: 'medium', type: 'harassment' } }),
    ];

    const profile = deriveBehaviorProfile(annotations);

    expect(profile.intent).toBe('critique');
    expect(profile.tone.bucket).toBe('excited');
    expect(profile.tone.highArousal).toBe(true);
    expect(profile.risk).toEqual({ level: 'med', type: 'harassment' });
    expect(profile.responseMode).toBe('deescalate');
    expect(profile.policy.shouldUseTools).toBe(false);
    expect(profile.policy.shouldDeescalate).toBe(true);
    expect(profile.gate).toBe('PROCEED');
  });

  test('defaults malformed annotations defensively', () => {
    const annotations: AnnotationV1[] = [
      annotation({ kind: 'intent', value: 'unknown-mode' }),
      annotation({ kind: 'tone', payload: { valence: 'bogus', arousal: null } as any }),
      annotation({ kind: 'risk', label: 'surprise', payload: { level: 'surprise', type: 'mystery' } as any }),
    ];

    const profile = deriveBehaviorProfile(annotations);

    expect(profile.intent).toBe('question');
    expect(profile.tone).toMatchObject({ valence: 0, arousal: 0, bucket: 'neutral', highArousal: false });
    expect(profile.risk).toEqual({ level: 'none', type: 'none' });
    expect(profile.responseMode).toBe('answer');
  });

  test('risk precedence overrides intent and tone for high-risk events', () => {
    const annotations: AnnotationV1[] = [
      annotation({ kind: 'intent', value: 'joke' }),
      annotation({ kind: 'tone', payload: { valence: 0.9, arousal: 0.4 } }),
      annotation({ kind: 'risk', label: 'high', payload: { level: 'high', type: 'illegal' } }),
    ];

    const profile = deriveBehaviorProfile(annotations, { riskResponseMode: 'safe-complete' });

    expect(profile.responseMode).toBe('refuse');
    expect(profile.policy.shouldRespond).toBe(false);
    expect(profile.policy.shouldRefuse).toBe(true);
    expect(profile.policy.requiresEscalationAnnotation).toBe(true);
    expect(profile.gate).toBe('ESCALATE');
  });

  test('safe-complete mode marks medium-risk self-harm for safe completion', () => {
    const annotations: AnnotationV1[] = [
      annotation({ kind: 'intent', value: 'question' }),
      annotation({ kind: 'risk', label: 'med', payload: { level: 'med', type: 'self_harm' } }),
    ];

    const profile = deriveBehaviorProfile(annotations, { riskResponseMode: 'safe-complete' });

    expect(profile.responseMode).toBe('refuse');
    expect(profile.policy.requiresSafeCompletion).toBe(true);
    expect(profile.policy.shouldUseTools).toBe(false);
    expect(profile.gate).toBe('SAFE_REFUSAL');
  });

  test('tone bucket thresholds are deterministic', () => {
    expect(deriveToneBucket(-0.7, 0.2)).toBe('hostile');
    expect(deriveToneBucket(-0.4, 0.1)).toBe('negative');
    expect(deriveToneBucket(0.1, 0.1)).toBe('neutral');
    expect(deriveToneBucket(0.5, 0.2)).toBe('positive');
    expect(deriveToneBucket(0.5, 0.8)).toBe('excited');
  });

  test('behavioral guidance stays human-readable and policy-oriented', () => {
    const profile = deriveBehaviorProfile([
      annotation({ kind: 'intent', value: 'meta' }),
      annotation({ kind: 'tone', payload: { valence: -0.3, arousal: 0.8 } }),
      annotation({ kind: 'risk', label: 'low', payload: { level: 'low', type: 'none' } }),
    ]);

    expect(buildBehavioralGuidance(profile)).toEqual(expect.arrayContaining([
      'Detected user intent: meta.',
      'Detected safety risk: low.',
      'Keep the response brief and avoid escalating language.',
      'Be transparent about the bot or system behavior relevant to the request.',
    ]));
  });
});
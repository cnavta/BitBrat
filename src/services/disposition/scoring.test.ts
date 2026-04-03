import { DEFAULT_DISPOSITION_CONFIG } from '../../types/disposition';
import { computeDispositionSnapshot } from './scoring';

function observation(overrides: Partial<any> = {}) {
  return {
    v: '1',
    correlationId: overrides.correlationId || 'corr',
    observedAt: overrides.observedAt || '2026-04-03T00:00:00Z',
    userKey: overrides.userKey || 'user-1',
    identity: overrides.identity || { userId: 'user-1', external: { platform: 'twitch', id: '123' } },
    message: overrides.message || { textLength: 12, language: 'en' },
    analysis: overrides.analysis || {
      intent: 'question',
      tone: { valence: 0, arousal: 0.2 },
      risk: { level: 'none', type: 'none' },
    },
    source: overrides.source || 'query-analyzer',
  };
}

describe('disposition scoring', () => {
  test('returns insufficient-signal below minimum events', () => {
    const snapshot = computeDispositionSnapshot([
      observation(),
      observation({ correlationId: 'corr-2', observedAt: '2026-04-03T00:01:00Z' }),
    ] as any, DEFAULT_DISPOSITION_CONFIG, '2026-04-03T00:02:00Z');

    expect(snapshot.band).toBe('insufficient-signal');
    expect(snapshot.window.messageCount).toBe(2);
  });

  test('prioritizes high-risk when a recent high-risk signal exists', () => {
    const snapshot = computeDispositionSnapshot([
      observation({ correlationId: 'corr-1', observedAt: '2026-04-03T00:00:00Z', analysis: { intent: 'critique', tone: { valence: -0.8, arousal: 0.9 }, risk: { level: 'high', type: 'harassment' } } }),
      observation({ correlationId: 'corr-2', observedAt: '2026-04-03T00:01:00Z', analysis: { intent: 'critique', tone: { valence: -0.7, arousal: 0.8 }, risk: { level: 'med', type: 'harassment' } } }),
      observation({ correlationId: 'corr-3', observedAt: '2026-04-03T00:02:00Z', analysis: { intent: 'question', tone: { valence: -0.3, arousal: 0.4 }, risk: { level: 'none', type: 'none' } } }),
    ] as any, DEFAULT_DISPOSITION_CONFIG, '2026-04-03T00:03:00Z');

    expect(snapshot.band).toBe('high-risk');
    expect(snapshot.flags).toContain('monitor-safety');
    expect(snapshot.flags).toContain('restrict-tools');
  });

  test('marks supportive when positive signals dominate', () => {
    const snapshot = computeDispositionSnapshot([
      observation({ correlationId: 'corr-1', observedAt: '2026-04-03T00:00:00Z', analysis: { intent: 'praise', tone: { valence: 0.9, arousal: 0.3 }, risk: { level: 'none', type: 'none' } } }),
      observation({ correlationId: 'corr-2', observedAt: '2026-04-03T00:01:00Z', analysis: { intent: 'praise', tone: { valence: 0.8, arousal: 0.2 }, risk: { level: 'none', type: 'none' } } }),
      observation({ correlationId: 'corr-3', observedAt: '2026-04-03T00:02:00Z', analysis: { intent: 'question', tone: { valence: 0.5, arousal: 0.2 }, risk: { level: 'none', type: 'none' } } }),
    ] as any, DEFAULT_DISPOSITION_CONFIG, '2026-04-03T00:03:00Z');

    expect(snapshot.band).toBe('supportive');
    expect(snapshot.indicators.supportivenessIndex).toBeGreaterThan(snapshot.indicators.frictionIndex);
  });
});
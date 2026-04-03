import { buildDispositionObservationEvent, deriveDispositionUserKey } from './observation';

describe('disposition observation helpers', () => {
  test('prefers internal user id for userKey derivation', () => {
    const key = deriveDispositionUserKey({
      identity: {
        external: { platform: 'twitch', id: 'external-1' },
        user: { id: 'user-1' },
      },
    } as any);

    expect(key).toBe('user-1');
  });

  test('falls back to external composite identity', () => {
    const key = deriveDispositionUserKey({
      identity: {
        external: { platform: 'discord', id: 'abc123' },
      },
    } as any);

    expect(key).toBe('discord:abc123');
  });

  test('builds an observation payload without raw message text', () => {
    const event = buildDispositionObservationEvent(
      {
        correlationId: 'corr-1',
        identity: {
          external: { platform: 'twitch', id: '123' },
          user: { id: 'internal-1' },
        },
        message: { id: 'm-1', text: 'hello there', language: 'en' },
      } as any,
      {
        intent: 'critique',
        tone: { valence: -0.4, arousal: 0.7 },
        risk: { level: 'med', type: 'harassment' },
      },
      'query-analyzer',
      '2026-04-03T00:00:00Z'
    );

    expect(event).toEqual({
      v: '1',
      correlationId: 'corr-1',
      observedAt: '2026-04-03T00:00:00Z',
      userKey: 'internal-1',
      identity: {
        userId: 'internal-1',
        external: { platform: 'twitch', id: '123' },
      },
      message: {
        id: 'm-1',
        textLength: 11,
        language: 'en',
      },
      analysis: {
        intent: 'critique',
        tone: { valence: -0.4, arousal: 0.7 },
        risk: { level: 'med', type: 'harassment' },
      },
      source: 'query-analyzer',
    });
    expect((event as any)?.message?.text).toBeUndefined();
  });
});
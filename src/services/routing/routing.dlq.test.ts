import { buildDlqEvent } from './dlq';
import { InternalEventV2 } from '../../types/events';

describe('dlq builder', () => {
  it('builds a router.deadletter.v1 event with slip summary', () => {
    const original: InternalEventV2 = {
      v: '2',
      type: 'chat.message.v1',
      correlationId: 'c-1',
      ingress: {
        ingressAt: '2026-01-29T22:00:00Z',
        source: 'ingress',
        channel: '#chan',
      },
      identity: {
        external: {
          id: 'u1',
          platform: 'test',
        }
      },
      egress: { destination: 'test' },
      routingSlip: [
        { id: 'router', status: 'OK' },
        { id: 'llm-bot', status: 'PENDING' },
      ],
      payload: { text: 'hi' },
    } as any;

    const dlq = buildDlqEvent({ original, reason: 'test', error: new Error('boom') });
    expect(dlq.type).toBe('router.deadletter.v1');
    expect(dlq.correlationId).toBe('c-1');
    expect(dlq.payload!.reason).toBe('test');
    expect(dlq.payload!.slipSummary).toContain('router:OK');
    expect(dlq.payload!.lastStepId).toBe('llm-bot');
  });

  it('handles V2 events', () => {
    const originalV2: InternalEventV2 = {
      v: '2',
      correlationId: 'c-v2',
      type: 'chat.message.v1',
      ingress: {
        ingressAt: '2026-01-29T22:00:00Z',
        source: 'api-gateway',
      },
      identity: {
        external: {
          id: 'user-1',
          platform: 'api-gateway',
        }
      },
      egress: { destination: 'api-gateway' },
      payload: { text: 'hello' }
    } as any;

    const dlq = buildDlqEvent({ original: originalV2, reason: 'user_not_found' });
    expect(dlq.correlationId).toBe('c-v2');
    expect(dlq.payload!.originalType).toBe('chat.message.v1');
  });

  it('captures egress context and metadata', () => {
    const original: InternalEventV2 = {
      v: '2',
      correlationId: 'c-egress',
      type: 'chat.message.v1',
      ingress: {
        ingressAt: '2026-01-29T22:00:00Z',
        source: 'ingress.twitch',
      },
      identity: {
        external: {
          id: 'user-twitch',
          platform: 'twitch',
        }
      },
      egress: { destination: 'twitch' },
      metadata: { platform: 'twitch', channelId: '123' },
      payload: { text: 'failed message' }
    } as any;

    const dlq = buildDlqEvent({ original, reason: 'terminal_delivery_failure' });
    expect(dlq.payload!.egressSource).toBe('ingress.twitch');
    expect(dlq.payload!.metadata.platform).toBe('twitch');
    expect(dlq.payload!.metadata.channelId).toBe('123');
  });
});

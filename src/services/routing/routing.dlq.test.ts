import { buildDlqEvent } from './dlq';
import { InternalEventV1 } from '../../types/events';

describe('dlq builder', () => {
  it('builds a router.deadletter.v1 event with slip summary', () => {
    const original: InternalEventV1 = {
      envelope: { v: '1', source: 'ingress', correlationId: 'c-1', egress: { destination: 'test' }, routingSlip: [
        { id: 'router', status: 'OK' },
        { id: 'llm-bot', status: 'PENDING' },
      ] },
      type: 'chat.message.v1',
      channel: '#chan',
      userId: 'u1',
      payload: { text: 'hi' },
    } as any;

    const dlq = buildDlqEvent({ original, reason: 'test', error: new Error('boom') });
    expect(dlq.type).toBe('router.deadletter.v1');
    expect(dlq.envelope.correlationId).toBe('c-1');
    expect(dlq.payload.reason).toBe('test');
    expect(dlq.payload.slipSummary).toContain('router:OK');
    expect(dlq.payload.lastStepId).toBe('llm-bot');
  });

  it('handles V2 events (flattened)', () => {
    const originalV2 = {
      v: '1',
      source: 'api-gateway',
      correlationId: 'c-v2',
      egress: { destination: 'api-gateway' },
      type: 'chat.message',
      userId: 'user-1',
      payload: { text: 'hello' }
    } as any;

    const dlq = buildDlqEvent({ original: originalV2, reason: 'user_not_found' });
    expect(dlq.envelope.correlationId).toBe('c-v2');
    expect(dlq.payload.originalType).toBe('chat.message');
  });

  it('captures egress context and metadata', () => {
    const original = {
      v: '1',
      source: 'ingress.twitch',
      correlationId: 'c-egress',
      egress: { destination: 'twitch' },
      type: 'chat.message',
      metadata: { platform: 'twitch', channelId: '123' },
      payload: { text: 'failed message' }
    } as any;

    const dlq = buildDlqEvent({ original, reason: 'terminal_delivery_failure' });
    expect(dlq.payload.egressSource).toBe('ingress.twitch');
    expect(dlq.payload.metadata.platform).toBe('twitch');
    expect(dlq.payload.metadata.channelId).toBe('123');
  });
});

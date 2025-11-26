import { buildDlqEvent } from './dlq';
import { InternalEventV1 } from '../../types/events';

describe('dlq builder', () => {
  it('builds a router.deadletter.v1 event with slip summary', () => {
    const original: InternalEventV1 = {
      envelope: { v: '1', source: 'ingress', correlationId: 'c-1', routingSlip: [
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
});

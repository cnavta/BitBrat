import { normalizeDeadLetterPayload } from './model';

describe('persistence/dlq_raw', () => {
  test('normalizeDeadLetterPayload handles wrapped DLQ payload', () => {
    const wrapped = {
      correlationId: 'c-wrapped',
      type: 'chat.message.v1',
      payload: {
        reason: 'CLIENT_OFFLINE',
        error: { code: 'offline', message: 'not connected' },
        originalType: 'chat.message.v1'
      }
    };
    const patch = normalizeDeadLetterPayload(wrapped);
    expect(patch.status).toBe('ERROR');
    expect(patch.deadletter?.reason).toBe('CLIENT_OFFLINE');
    expect(patch.deadletter?.error?.code).toBe('offline');
  });

  test('normalizeDeadLetterPayload handles raw event (V2) and infers reason', () => {
    const rawEvent = {
      v: '1',
      source: 'ingress.twitch',
      correlationId: 'c-raw',
      type: 'chat.message.v1',
      message: { id: 'm1', role: 'user', text: 'hello' },
      routingSlip: [{ id: 'router', nextTopic: 'internal.router.dlq.v1', status: 'PENDING' }]
    };
    const patch = normalizeDeadLetterPayload(rawEvent);
    
    expect(patch.status).toBe('ERROR');
    expect(patch.deadletter?.reason).toBe('NO_ROUTING_MATCH');
    expect(patch.deadletter?.originalType).toBe('chat.message.v1');
    // Ensure original fields are preserved
    expect((patch as any).message?.text).toBe('hello');
  });

  test('normalizeDeadLetterPayload handles raw event via destination parameter', () => {
    const rawEvent = {
      v: '1',
      source: 'ingress.twitch',
      correlationId: 'c-raw-dest',
      type: 'chat.message.v1',
    };
    const patch = normalizeDeadLetterPayload(rawEvent, 'internal.router.dlq.v1');
    
    expect(patch.deadletter?.reason).toBe('NO_ROUTING_MATCH');
  });
});

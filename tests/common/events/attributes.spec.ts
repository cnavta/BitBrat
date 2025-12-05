import { busAttrsFromEvent } from '../../../src/common/events/attributes';

describe('busAttrsFromEvent', () => {
  it('emits idempotencyKey when correlationId is present', () => {
    const evt: any = { type: 'x', source: 's', correlationId: 'c-123', traceId: 't-1' };
    const attrs = busAttrsFromEvent(evt);
    expect(attrs.correlationId).toBe('c-123');
    expect(attrs.idempotencyKey).toBe('c-123');
  });

  it('omits idempotencyKey when no correlationId is present', () => {
    const evt: any = { type: 'x', source: 's' };
    const attrs = busAttrsFromEvent(evt);
    expect(attrs.idempotencyKey as any).toBeUndefined();
  });
});

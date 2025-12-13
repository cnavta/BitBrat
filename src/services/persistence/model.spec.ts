import { normalizeFinalizePayload, normalizeIngressEvent } from './model';
import type { InternalEventV2 } from '../../types/events';

describe('persistence/model', () => {
  test('normalizeIngressEvent maps InternalEventV2 into EventDocV1', () => {
    const evt: InternalEventV2 = {
      v: '1',
      source: 'ingress.twitch',
      correlationId: 'abc-123',
      type: 'chat.message.v1',
      message: { id: 'm1', role: 'user', text: 'hello' },
      annotations: [{ id: 'a1', kind: 'intent', source: 'test', createdAt: new Date().toISOString() }],
      candidates: [],
      errors: [],
      egressDestination: 'egress://default',
    } as any;
    const doc = normalizeIngressEvent(evt);
    expect(doc.correlationId).toBe('abc-123');
    expect(doc.type).toBe('chat.message.v1');
    expect(doc.message).toEqual(evt.message);
    expect(doc.egressDestination).toBe('egress://default');
    expect(doc.status).toBe('INGESTED');
    expect(typeof doc.ingestedAt).toBe('string');
    expect(doc.raw).toBe(evt);
  });

  test('normalizeFinalizePayload supports flat and nested shapes', () => {
    const flat = normalizeFinalizePayload({
      correlationId: 'abc-123',
      destination: 'egress://default',
      deliveredAt: '2024-01-01T00:00:00Z',
      providerMessageId: 'msg-1',
      status: 'SENT',
      metadata: { ok: true },
    });
    expect(flat.correlationId).toBe('abc-123');
    expect(flat.status).toBe('SENT');
    expect(flat.destination).toBe('egress://default');

    const nested = normalizeFinalizePayload({
      correlationId: 'z',
      egress: { destination: 'd', providerMessageId: 'p', status: 'SENT', metadata: { x: 1 } },
    });
    expect(nested.correlationId).toBe('z');
    expect(nested.destination).toBe('d');
    expect(nested.status).toBe('SENT');
  });
});

import { normalizeFinalizePayload, normalizeIngressEvent, normalizeSourceStatus } from './model';
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
    // Ingress metadata should be captured
    expect(doc.ingress).toBeTruthy();
    expect(doc.ingress!.source).toBe('ingress.twitch');
    expect(doc.ingress!.destination).toBe('internal.ingress.v1');
    expect(typeof doc.ingress!.receivedAt).toBe('string');
    // raw property removed from EventDocV1 to avoid duplication
    expect('raw' in (doc as any)).toBe(false);
  });

  test('normalizeIngressEvent strips undefined properties recursively', () => {
    const evt: InternalEventV2 = {
      v: '1',
      source: 'ingress.twitch',
      correlationId: 'undef-1',
      type: 'chat.message.v1',
      // Explicit undefineds to simulate problematic payloads
      annotations: undefined as any,
      candidates: undefined as any,
      message: { id: 'm1', role: 'user', text: 'hello', rawPlatformPayload: { foo: undefined as any } as any } as any,
    } as any;
    const doc = normalizeIngressEvent(evt);
    // Should not include top-level annotations/candidates when undefined
    expect('annotations' in (doc as any)).toBe(false);
    expect('candidates' in (doc as any)).toBe(false);
    // Nested undefined removed
    expect('foo' in ((doc.message as any).rawPlatformPayload || {})).toBe(false);
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

  test('normalizeFinalizePayload carries annotations and candidates when provided', () => {
    const now = new Date().toISOString();
    const out = normalizeFinalizePayload({
      correlationId: 'c-x',
      status: 'SENT',
      annotations: [{ id: 'a1', kind: 'intent', source: 't', createdAt: now }],
      candidates: [
        { id: 'c1', kind: 'text', source: 't', createdAt: now, status: 'selected', priority: 1, text: 'hi' },
      ],
    });
    expect(out.correlationId).toBe('c-x');
    expect(Array.isArray(out.annotations)).toBe(true);
    expect(Array.isArray(out.candidates)).toBe(true);
    expect(out.candidates![0].status).toBe('selected');
  });

  test('normalizeSourceStatus handles Twilio status events', () => {
    const evt: InternalEventV2 = {
      v: '1',
      source: 'ingress.twilio',
      type: 'system.source.status',
      payload: {
        platform: 'twilio',
        id: '+1234567890',
        status: 'CONNECTED',
        displayName: 'Twilio Bot',
        metrics: { messagesIn: 10, messagesOut: 10, errors: 0 }
      }
    } as any;

    const patch = normalizeSourceStatus(evt);
    expect(patch.platform).toBe('twilio');
    expect(patch.id).toBe('+1234567890');
    expect(patch.status).toBe('CONNECTED');
    expect(patch.displayName).toBe('Twilio Bot');
    expect(patch.metrics?.messagesIn).toBe(10);
    expect(patch.lastStatusUpdate).toBeDefined();
    expect(patch.metrics?.lastHeartbeat).toBeDefined();
  });
});

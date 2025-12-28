import { SmsEnvelopeBuilder, TwilioMessageMeta } from './envelope-builder';

describe('SmsEnvelopeBuilder', () => {
  const builder = new SmsEnvelopeBuilder();
  const fixedNow = '2025-01-01T00:00:00.000Z';
  const uuidSeq = ['u1', 'u2', 'u3'];
  let idx = 0;
  const uuid = () => uuidSeq[idx++ % uuidSeq.length];

  beforeEach(() => {
    idx = 0;
  });

  it('maps Twilio message meta to InternalEventV2 with annotations and egressDestination', () => {
    const meta: TwilioMessageMeta = {
      sid: 'IM123',
      conversationSid: 'CH123',
      author: '+1234567890',
      body: 'Hello from Twilio SMS',
      dateCreated: new Date(fixedNow),
      attributes: { some: 'attr' },
    };

    const evt = builder.build(meta, { uuid, nowIso: () => fixedNow, egressDestination: 'internal.egress.v1.proc123' });
    
    expect(evt.v).toBe('1');
    expect(evt.source).toBe('ingress.twilio.sms');
    expect(evt.correlationId).toBe('u1');
    expect(evt.traceId).toBe('u2');
    expect(evt.type).toBe('chat.message.v1');
    expect(evt.channel).toBe('CH123');
    expect(evt.userId).toBe('+1234567890');
    expect(evt.egressDestination).toBe('internal.egress.v1.proc123');
    expect(evt.message?.id).toBe('IM123');
    expect(evt.message?.role).toBe('user');
    expect(evt.message?.text).toBe('Hello from Twilio SMS');
    expect(evt.message?.rawPlatformPayload?.sid).toBe('IM123');
    expect(evt.message?.rawPlatformPayload?.conversationSid).toBe('CH123');
    expect(evt.message?.rawPlatformPayload?.author).toBe('+1234567890');
    expect(evt.message?.rawPlatformPayload?.body).toBe('Hello from Twilio SMS');
    expect(evt.message?.rawPlatformPayload?.dateCreated).toBe(fixedNow);
    expect(evt.message?.rawPlatformPayload?.attributes).toEqual({ some: 'attr' });
    
    expect(Array.isArray(evt.annotations)).toBe(true);
    const ann = evt.annotations![0];
    expect(ann.id).toBe('u3');
    expect(ann.source).toBe('twilio');
    expect(ann.label).toBe('source');
    expect(ann.payload?.conversationSid).toBe('CH123');
    expect(ann.payload?.author).toBe('+1234567890');
  });

  it('handles null body by providing an empty string in message.text', () => {
    const meta: TwilioMessageMeta = {
      sid: 'IM456',
      conversationSid: 'CH456',
      author: '+1234567890',
      body: null,
      dateCreated: new Date(fixedNow),
      attributes: {},
    };

    const evt = builder.build(meta, { uuid, nowIso: () => fixedNow });
    expect(evt.message?.text).toBe('');
    expect(evt.message?.rawPlatformPayload?.body).toBeNull();
  });
});

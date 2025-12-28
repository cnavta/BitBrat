import { TwilioEnvelopeBuilder, TwilioMessageLike } from '../twilio-envelope-builder';

describe('TwilioEnvelopeBuilder', () => {
  const builder = new TwilioEnvelopeBuilder();
  const fixedNow = '2025-01-01T00:00:00.000Z';
  const uuidSeq = ['u1', 'u2'];
  let idx = 0;
  const uuid = () => uuidSeq[idx++ % uuidSeq.length];

  it('correctly maps Twilio message fields into InternalEventV2', () => {
    const msg: TwilioMessageLike = {
      sid: 'IM123',
      author: '+1234567890',
      body: 'Hello from Twilio',
      dateCreated: new Date(fixedNow),
      conversation: {
        sid: 'CH456'
      }
    };

    const evt = builder.build(msg, { uuid, nowIso: () => fixedNow });

    expect(evt.v).toBe('1');
    expect(evt.source).toBe('ingress.twilio');
    expect(evt.correlationId).toBe('u1');
    expect(evt.traceId).toBe('u2');
    expect(evt.type).toBe('chat.message.v1');
    expect(evt.channel).toBe('CH456');
    expect(evt.userId).toBe('+1234567890');
    expect(evt.message?.text).toBe('Hello from Twilio');
    expect(evt.message?.id).toBe('IM123');
    expect(evt.message?.rawPlatformPayload?.author).toBe('+1234567890');
    expect(evt.message?.rawPlatformPayload?.conversationSid).toBe('CH456');
    expect(evt.message?.rawPlatformPayload?.timestamp).toBe(fixedNow);
  });

  it('handles missing author and date gracefully', () => {
    const msg: TwilioMessageLike = {
      sid: 'IM999',
      author: null,
      body: 'Body only',
      dateCreated: null,
      conversation: {
        sid: 'CH789'
      }
    };

    const evt = builder.build(msg, { uuid, nowIso: () => fixedNow });
    expect(evt.userId).toBe('unknown');
    expect(evt.message?.rawPlatformPayload?.timestamp).toBe(fixedNow);
  });
});

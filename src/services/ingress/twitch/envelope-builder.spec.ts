import { TwitchEnvelopeBuilder, IrcMessageMeta } from './envelope-builder';

describe('TwitchEnvelopeBuilder', () => {
  const builder = new TwitchEnvelopeBuilder();
  const fixedNow = '2025-01-01T00:00:00.000Z';
  const uuidSeq = ['u1', 'u2'];
  let idx = 0;
  const uuid = () => uuidSeq[idx++ % uuidSeq.length];

  it('maps basic IRC fields into InternalEventV2 envelope', () => {
    const msg: IrcMessageMeta = {
      channel: 'bitbrat',
      userLogin: 'someuser',
      userDisplayName: 'SomeUser',
      userId: '123',
      roomId: '456',
      messageId: 'abc',
      text: 'Hello 👋',
      color: '#AABBCC',
      badges: ['subscriber'],
      isMod: false,
      isSubscriber: true,
      emotes: [{ id: '25', start: 6, end: 7 }],
      raw: { tags: { 'badge-info': '' } },
    };

    const evt = builder.build(msg, { uuid, nowIso: () => fixedNow });
    expect(evt.v).toBe('2');
    expect(evt.ingress.source).toBe('ingress.twitch');
    expect(evt.correlationId).toBe('u1');
    expect(evt.traceId).toBe('u2');
    expect(evt.type).toBe('chat.message.v1');
    expect(evt.ingress.channel).toBe('#bitbrat');
    expect(evt.identity.external.id).toBe('123');
    expect(evt.message?.text).toBe('Hello 👋');
    expect(evt.message?.id).toBe('abc');
    expect(evt.message?.rawPlatformPayload?.user?.login).toBe('someuser');
    expect(evt.message?.rawPlatformPayload?.user?.displayName).toBe('SomeUser');
    expect(evt.message?.rawPlatformPayload?.roomId).toBe('456');
    expect(evt.message?.rawPlatformPayload?.color).toBe('#AABBCC');
    expect(evt.message?.rawPlatformPayload?.badges).toEqual(['subscriber']);
    expect(evt.message?.rawPlatformPayload?.isSubscriber).toBe(true);
    expect(evt.message?.rawPlatformPayload?.emotes).toEqual([{ id: '25', start: 6, end: 7 }]);
    expect(evt.message?.rawPlatformPayload?.timestamp).toBe(fixedNow);
  });

  it('normalizes channel to include # and tolerates missing optionals', () => {
    const msg: IrcMessageMeta = {
      channel: '#room',
      userLogin: 'user',
      text: 'hi',
    } as any;
    const evt = builder.build(msg, { uuid, nowIso: () => fixedNow });
    expect(evt.ingress.channel).toBe('#room');
    expect(evt.message?.id).toBeDefined();
    expect(evt.message?.rawPlatformPayload?.badges).toEqual([]);
    expect(evt.message?.rawPlatformPayload?.raw).toEqual({});
  });
});

import { TwitchEnvelopeBuilder, IrcMessageMeta } from './envelope-builder';

describe('TwitchEnvelopeBuilder', () => {
  const builder = new TwitchEnvelopeBuilder();
  const fixedNow = '2025-01-01T00:00:00.000Z';
  const uuidSeq = ['u1', 'u2'];
  let idx = 0;
  const uuid = () => uuidSeq[idx++ % uuidSeq.length];

  it('maps basic IRC fields into InternalEventV1 envelope', () => {
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
    expect(evt.envelope.v).toBe('1');
    expect(evt.envelope.source).toBe('ingress.twitch');
    expect(evt.envelope.correlationId).toBe('u1');
    expect(evt.envelope.traceId).toBe('u2');
    expect(evt.type).toBe('chat.message.v1');
    expect(evt.channel).toBe('#bitbrat');
    expect(evt.userId).toBe('123');
    expect(evt.payload.text).toBe('Hello 👋');
    expect(evt.payload.messageId).toBe('abc');
    expect(evt.payload.user.login).toBe('someuser');
    expect(evt.payload.user.displayName).toBe('SomeUser');
    expect(evt.payload.roomId).toBe('456');
    expect(evt.payload.color).toBe('#AABBCC');
    expect(evt.payload.badges).toEqual(['subscriber']);
    expect(evt.payload.isSubscriber).toBe(true);
    expect(evt.payload.emotes).toEqual([{ id: '25', start: 6, end: 7 }]);
    expect(evt.payload.timestamp).toBe(fixedNow);
  });

  it('normalizes channel to include # and tolerates missing optionals', () => {
    const msg: IrcMessageMeta = {
      channel: '#room',
      userLogin: 'user',
      text: 'hi',
    } as any;
    const evt = builder.build(msg, { uuid, nowIso: () => fixedNow });
    expect(evt.channel).toBe('#room');
    expect(evt.payload.messageId).toBe('');
    expect(evt.payload.badges).toEqual([]);
    expect(evt.payload.raw).toEqual({});
  });
});

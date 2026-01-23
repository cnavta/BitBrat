import { DiscordEnvelopeBuilder } from './envelope-builder';
import type { DiscordMessageMeta } from './discord-ingress-client';

describe('DiscordEnvelopeBuilder', () => {
  const builder = new DiscordEnvelopeBuilder();
  const fixedNow = '2025-01-01T00:00:00.000Z';
  const uuidSeq = ['u1', 'u2', 'u3'];
  let idx = 0;
  const uuid = () => uuidSeq[idx++ % uuidSeq.length];

  it('maps Discord message meta to InternalEventV2 with annotations and egress metadata', () => {
    const meta: DiscordMessageMeta = {
      guildId: 'g1',
      channelId: 'c1',
      messageId: 'm1',
      authorId: 'u42',
      authorName: 'Alice',
      content: 'Hello from Discord',
      createdAt: fixedNow,
      mentions: ['u99'],
      roles: ['r1'],
      raw: { foo: 'bar' },
    };

    const evt = builder.build(meta, { uuid, nowIso: () => fixedNow, egressDestination: 'internal.egress.v1.proc123' });
    expect(evt.v).toBe('1');
    expect(evt.source).toBe('ingress.discord');
    expect(evt.correlationId).toBe('u1');
    expect(evt.traceId).toBe('u2');
    expect(evt.type).toBe('chat.message.v1');
    expect(evt.channel).toBe('c1');
    expect(evt.userId).toBe('u42');
    expect(evt.egress?.destination).toBe('internal.egress.v1.proc123');
    expect(evt.egress?.type).toBe('chat');
    expect(evt.message?.id).toBe('m1');
    expect(evt.message?.role).toBe('user');
    expect(evt.message?.text).toBe('Hello from Discord');
    expect(evt.message?.rawPlatformPayload?.guildId).toBe('g1');
    expect(evt.message?.rawPlatformPayload?.channelId).toBe('c1');
    expect(evt.message?.rawPlatformPayload?.authorId).toBe('u42');
    expect(evt.message?.rawPlatformPayload?.authorName).toBe('Alice');
    expect(evt.message?.rawPlatformPayload?.mentions).toEqual(['u99']);
    expect(evt.message?.rawPlatformPayload?.roles).toEqual(['r1']);
    expect(evt.message?.rawPlatformPayload?.timestamp).toBe(fixedNow);
    expect(Array.isArray(evt.annotations)).toBe(true);
    const ann = evt.annotations![0];
    expect(ann.source).toBe('discord');
    expect(ann.label).toBe('source');
    expect(ann.payload?.guildId).toBe('g1');
    expect(ann.payload?.channelId).toBe('c1');
  });
});

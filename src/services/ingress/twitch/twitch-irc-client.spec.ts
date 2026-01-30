import { TwitchIrcClient } from './twitch-irc-client';
import type { IEnvelopeBuilder } from './envelope-builder';
import type { ITwitchIngressPublisher } from './publisher';

describe('TwitchIrcClient integration scaffolding', () => {
  const builder: jest.Mocked<IEnvelopeBuilder> = {
    build: jest.fn(),
  } as any;
  const publisher: jest.Mocked<ITwitchIngressPublisher> = {
    publish: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('start marks CONNECTED and sets joined channels from env', async () => {
    process.env.TWITCH_CHANNELS = 'chan1, #chan2';
    const client = new TwitchIrcClient(builder, publisher);
    await client.start();
    const snap = client.getSnapshot();
    expect(snap.state).toBe('CONNECTED');
    expect(snap.joinedChannels).toEqual(['#chan1', '#chan2']);
  });

  it('handleMessage builds envelope and publishes V2, updating counters', async () => {
    const client = new TwitchIrcClient(builder, publisher, ['chan']);
    await client.start();
    builder.build.mockReturnValue({
      v: '2',
      correlationId: 'c',
      routingSlip: [],
      type: 'chat.message.v1',
      ingress: { ingressAt: new Date().toISOString(), source: 'ingress.twitch' },
      identity: { external: { id: 'u1', platform: 'twitch' } },
      message: { id: 'm1', role: 'user', text: 'hi', rawPlatformPayload: { ok: true } },
    } as any);
    publisher.publish.mockResolvedValue('mid-1');

    await client.handleMessage('#chan', 'user1', 'hello', { userId: 'u1', messageId: 'm1' });

    expect(builder.build).toHaveBeenCalledTimes(1);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const published = (publisher.publish.mock.calls[0] as any[])[0];
    // Published event is V2 with flattened envelope fields
    expect(published.v).toBe('2');
    expect(published.ingress.source).toBe('ingress.twitch');
    expect(published.type).toBe('chat.message.v1');
    expect(published.correlationId).toBe('c');
    // rawPlatformPayload should carry original payload
    expect(published.message.rawPlatformPayload).toEqual({ ok: true });
    const snap = client.getSnapshot();
    expect(snap.counters?.received).toBe(1);
    expect(snap.counters?.published).toBe(1);
    expect(snap.counters?.failed).toBe(0);
    expect(snap.lastMessageAt).toBeDefined();
    expect(snap.lastError).toBeUndefined();
  });

  it('handleMessage increments failed on publish error and surfaces lastError', async () => {
    const client = new TwitchIrcClient(builder, publisher, ['chan']);
    await client.start();
    builder.build.mockReturnValue({
      v: '2', ingress: { source: 'ingress.twitch' }, correlationId: 'c', routingSlip: [], type: 'chat.message.v1', message: { id: 'm2', role: 'user', text: 'hi' },
    } as any);
    publisher.publish.mockRejectedValue(new Error('bus down'));

    await expect(client.handleMessage('#chan', 'user1', 'hi')).rejects.toThrow('bus down');
    const snap = client.getSnapshot();
    expect(snap.counters?.failed).toBe(1);
    expect(snap.lastError?.message).toContain('bus down');
  });

  it('injects egress metadata when missing and option provided', async () => {
    const client = new TwitchIrcClient(builder, publisher, ['chan'], { egressDestinationTopic: 'internal.egress.v1.inst1' });
    await client.start();
    const evt: any = { v: '2', ingress: { source: 'ingress.twitch' }, correlationId: 'c', routingSlip: [], type: 'chat.message.v1', message: { id: 'm3', role: 'user', text: 'hi' } };
    builder.build.mockReturnValue(evt);
    publisher.publish.mockResolvedValue('mid-2');

    await client.handleMessage('#chan', 'user1', 'hi');

    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const publishedEvt = (publisher.publish.mock.calls[0] as any[])[0];
    expect(publishedEvt.egress.destination).toBe('internal.egress.v1.inst1');
    expect(publishedEvt.egress.type).toBe('chat');
  });

  describe('sendWhisper', () => {
    it('sends whisper via helix client when connected', async () => {
      const client = new TwitchIrcClient(builder, publisher, ['chan']);
      await client.start();
      
      // Mock snapshot userId (usually set from credentials provider)
      (client as any).snapshot.userId = 'bot123';
      
      const mockHelix = {
        whispers: {
          sendWhisper: jest.fn().mockResolvedValue(undefined),
        }
      };
      (client as any).helix = mockHelix;

      await client.sendWhisper('hello whisper', 'user456');

      expect(mockHelix.whispers.sendWhisper).toHaveBeenCalledWith('bot123', 'user456', 'hello whisper');
    });

    it('throws error if bot userId is unknown', async () => {
      const client = new TwitchIrcClient(builder, publisher, ['chan']);
      await client.start();
      
      const mockHelix = {
        whispers: {
          sendWhisper: jest.fn(),
        }
      };
      (client as any).helix = mockHelix;

      await expect(client.sendWhisper('hi', 'u1')).rejects.toThrow('bot_user_id_unknown');
    });

    it('logs warning and does nothing if text or userId is missing', async () => {
      const client = new TwitchIrcClient(builder, publisher, ['chan']);
      await client.start();
      
      const mockHelix = {
        whispers: {
          sendWhisper: jest.fn(),
        }
      };
      (client as any).helix = mockHelix;

      await client.sendWhisper('', 'u1');
      await client.sendWhisper('hi', '');

      expect(mockHelix.whispers.sendWhisper).not.toHaveBeenCalled();
    });
  });
});

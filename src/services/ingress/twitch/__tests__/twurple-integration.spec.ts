import { TwitchIrcClient } from '../twitch-irc-client';
import type { IEnvelopeBuilder } from '../envelope-builder';
import type { ITwitchIngressPublisher } from '../publisher';

/**
 * Integration-style test (mocked Twurple):
 * Simulate Twurple's onMessage by calling TwitchIrcClient.handleMessage and
 * ensure a publish occurs with the built event.
 */
describe('Twurple onMessage → Envelope → Publish (mocked)', () => {
  const builder: jest.Mocked<IEnvelopeBuilder> = { build: jest.fn() } as any;
  const publisher: jest.Mocked<ITwitchIngressPublisher> = { publish: jest.fn() } as any;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('publishes exactly once per incoming message (V2 payload)', async () => {
    const client = new TwitchIrcClient(builder, publisher, ['bitbrat']);
    await client.start();

    const evt = {
      v: '1',
      source: 'ingress.twitch',
      correlationId: 'c1',
      routingSlip: [],
      type: 'chat.message.v1',
      message: { id: 'm-1', role: 'user', text: 'Hello', rawPlatformPayload: { text: 'Hello' } },
      channel: '#bitbrat',
    } as any;
    builder.build.mockReturnValue(evt);
    publisher.publish.mockResolvedValue('mid-xyz');

    // Simulate Twurple ChatClient onMessage(channel, user, text, msg)
    await client.handleMessage('#bitbrat', 'user123', 'Hello', { messageId: 'm-1', userId: 'u-1' });

    expect(builder.build).toHaveBeenCalledTimes(1);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const published = (publisher.publish.mock.calls[0] as any[])[0];
    expect(published && published.message && published.message.rawPlatformPayload).toEqual({ text: 'Hello' });
    expect(published.type).toBe('chat.message.v1');
  });
});

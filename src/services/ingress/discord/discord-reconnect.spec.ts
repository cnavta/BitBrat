import { DiscordIngressClient } from './discord-ingress-client';
import { DiscordEnvelopeBuilder } from './envelope-builder';

describe('Discord – Reconnection behavior', () => {
  let builder: any;
  let publisher: any;
  let tokenStore: any;
  let mockClientInstance: any;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    jest.useFakeTimers();
    builder = new DiscordEnvelopeBuilder();
    publisher = { publish: jest.fn(async () => {}) };
    mockClientInstance = {
      on: jest.fn(),
      once: jest.fn(),
      login: jest.fn(),
      destroy: jest.fn(),
    };

    jest.doMock('discord.js', () => ({
      Client: jest.fn(() => mockClientInstance),
      GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 4 },
      Partials: { Channel: 1, Message: 2 },
    }), { virtual: true });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetModules();
  });

  it('IE-DIS-10: should start polling and reconnect even if initial login fails', async () => {
    // Initial login fails
    mockClientInstance.login.mockRejectedValueOnce(new Error('Initial login failed'));

    tokenStore = {
      getAuthToken: jest.fn()
        .mockResolvedValueOnce({ accessToken: 'INITIAL_TOKEN' }) // First call in start -> resolveToken
        .mockResolvedValue({ accessToken: 'NEW_TOKEN' }),      // Subsequent calls in polling
    };

    const cfg: any = {
      discordEnabled: true,
      discordUseTokenStore: true,
      discordTokenPollMs: 1000,
      discordGuildId: 'g1',
      discordChannels: ['c1'],
    };

    const client = new DiscordIngressClient(builder, publisher, cfg, {}, tokenStore);

    // Initial start fails
    await expect(client.start()).rejects.toThrow('Initial login failed');
    expect(client.getSnapshot().state).toBe('ERROR');

    // Fast-forward time to trigger the poll
    // interval is Math.max(10000, discordTokenPollMs)
    await jest.advanceTimersByTimeAsync(11000);

    // If it worked, it should have called getAuthToken again and then login('NEW_TOKEN')
    // But currently, it won't even start the timer.
    expect(tokenStore.getAuthToken).toHaveBeenCalledTimes(2);
    expect(mockClientInstance.login).toHaveBeenCalledWith('NEW_TOKEN');
  });

  it('IE-DIS-11: reconnect() should work even if this.client is null (failed initial connection)', async () => {
    const cfg: any = {
      discordEnabled: true,
      discordUseTokenStore: true,
      discordGuildId: 'g1',
      discordChannels: ['c1'],
    };

    const client = new DiscordIngressClient(builder, publisher, cfg, {}, tokenStore);

    // simulate failed start where client is null or destroyed
    (client as any).client = null;

    // Manual reconnect call
    await (client as any).reconnect('NEW_TOKEN');

    // In current implementation, this will return early because of: if (!this.client) return;
    // So Client will NOT be instantiated and login will NOT be called.
    expect(mockClientInstance.login).toHaveBeenCalledWith('NEW_TOKEN');
  });
});

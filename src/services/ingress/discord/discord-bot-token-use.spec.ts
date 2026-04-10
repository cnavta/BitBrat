import { DiscordIngressClient } from './discord-ingress-client';
import { DiscordEnvelopeBuilder } from './envelope-builder';

describe('DiscordIngressClient - DISCORD_BOT_TOKEN usage', () => {
  let builder: any;
  let publisher: any;

  beforeEach(() => {
    builder = new DiscordEnvelopeBuilder();
    publisher = { publish: jest.fn(async () => {}) };
  });

  it('uses discordBotToken when discordUseTokenStore is false', async () => {
    const cfg: any = {
      discordEnabled: true,
      discordUseTokenStore: false,
      discordBotToken: 'MY_STATIC_BOT_TOKEN',
      discordGuildId: 'g1',
      discordChannels: ['c1'],
    };

    const client = new DiscordIngressClient(builder, publisher, cfg);
    const token = await (client as any).resolveToken();

    expect(token).toBe('MY_STATIC_BOT_TOKEN');
  });

  it('uses discordBotToken as fallback when discordUseTokenStore is true but store is empty and fallback enabled', async () => {
    const cfg: any = {
      discordEnabled: true,
      discordUseTokenStore: true,
      discordAllowEnvFallback: true,
      discordBotToken: 'FALLBACK_BOT_TOKEN',
      discordGuildId: 'g1',
      discordChannels: ['c1'],
    };

    const tokenStore: any = {
      getAuthToken: jest.fn().mockResolvedValue(null),
    };

    const client = new DiscordIngressClient(builder, publisher, cfg, {}, tokenStore);
    const token = await (client as any).resolveToken();

    expect(token).toBe('FALLBACK_BOT_TOKEN');
  });

  it('does NOT use discordBotToken when discordUseTokenStore is true and store has token', async () => {
    const cfg: any = {
      discordEnabled: true,
      discordUseTokenStore: true,
      discordBotToken: 'SHOULD_NOT_USE_THIS',
      discordGuildId: 'g1',
      discordChannels: ['c1'],
    };

    const tokenStore: any = {
      getAuthToken: jest.fn().mockResolvedValue({ accessToken: 'STORE_TOKEN' }),
    };

    const client = new DiscordIngressClient(builder, publisher, cfg, {}, tokenStore);
    const token = await (client as any).resolveToken();

    expect(token).toBe('STORE_TOKEN');
  });
});

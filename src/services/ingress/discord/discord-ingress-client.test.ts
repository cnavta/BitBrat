import { DiscordIngressClient } from './discord-ingress-client';
import type { IConfig } from '../../../types';

// Minimal stubs for required constructor args
const builder: any = { build: jest.fn((meta: any, opts: any) => ({ meta, opts })) };
const publisher: any = { publish: jest.fn(async () => {}) };

function makeCfg(overrides: Partial<IConfig> = {}): IConfig {
  return {
    port: 0,
    logLevel: 'error',
    twitchScopes: [],
    twitchChannels: [],
    discordEnabled: true,
    discordGuildId: 'g1',
    discordChannels: ['c1'],
    ...overrides,
  } as any;
}

describe('DiscordIngressClient token resolver and rotation', () => {
  afterEach(() => {
    jest.useRealTimers();
    // Ensure no timers leak into other test files
    try { jest.clearAllTimers(); } catch {}
    jest.clearAllMocks();
  });

  test('resolveToken uses store token when enabled and present', async () => {
    const cfg = makeCfg({ discordUseTokenStore: true });
    const tokenStore: any = {
      getAuthToken: jest.fn(async () => ({ provider: 'discord', identity: 'bot', tokenType: 'bot-token', accessToken: 'STORE_TOKEN', updatedAt: new Date().toISOString() })),
    };
    const client = new DiscordIngressClient(builder, publisher, cfg, {}, tokenStore);
    const tok = await (client as any).resolveToken();
    expect(tok).toBe('STORE_TOKEN');
    expect(tokenStore.getAuthToken).toHaveBeenCalledWith('discord', 'bot');
  });

  test('resolveToken uses env token directly when store disabled', async () => {
    const cfg = makeCfg({ discordUseTokenStore: false, discordBotToken: 'DIRECT_TOKEN' });
    const client = new DiscordIngressClient(builder, publisher, cfg);
    const tok = await (client as any).resolveToken();
    expect(tok).toBe('DIRECT_TOKEN');
  });

  test('resolveToken falls back to env token when store empty and fallback enabled', async () => {
    const cfg = makeCfg({ discordUseTokenStore: true, discordAllowEnvFallback: true, discordBotToken: 'ENV_TOKEN' });
    const tokenStore: any = { getAuthToken: jest.fn(async () => null) };
    const client = new DiscordIngressClient(builder, publisher, cfg, {}, tokenStore);
    const tok = await (client as any).resolveToken();
    expect(tok).toBe('ENV_TOKEN');
  });

  test('resolveToken throws when store empty and fallback disabled', async () => {
    const cfg = makeCfg({ discordUseTokenStore: true, discordAllowEnvFallback: false });
    const tokenStore: any = { getAuthToken: jest.fn(async () => null) };
    const client = new DiscordIngressClient(builder, publisher, cfg, {}, tokenStore);
    await expect((client as any).resolveToken()).rejects.toThrow(/discord_token_missing_in_store/);
  });

  test('rotation polling triggers reconnect when token changes', async () => {
    jest.useFakeTimers({ now: Date.now() });
    const cfg = makeCfg({ discordUseTokenStore: true, discordTokenPollMs: 1 }); // will be capped to 10_000
    let call = 0;
    const tokenStore: any = {
      getAuthToken: jest.fn(async () => {
        call += 1;
        // First poll will return different token than current
        return { provider: 'discord', identity: 'bot', tokenType: 'bot-token', accessToken: call > 0 ? 'NEXT' : 'CUR', updatedAt: new Date().toISOString() };
      }),
    };
    const client = new DiscordIngressClient(builder, publisher, cfg, {}, tokenStore);
    (client as any).currentToken = 'CUR';
    (client as any).reconnect = jest.fn(async () => {});

    // start the internal timer
    (client as any).startTokenPoll();

    // Advance to the enforced minimum interval (10s)
    // @ts-ignore
    await jest.advanceTimersByTimeAsync(10_000);

    expect((client as any).reconnect).toHaveBeenCalled();

    // Cleanup timer
    await (client as any).stop();
  });
});

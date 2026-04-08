import { DiscordAdapter } from './discord-adapter';
import type { IConfig } from '../../../types';
import { BaseServer } from '../../../common/base-server';

describe('DiscordAdapter', () => {
  const baseCfg: IConfig = {
    port: 0,
    logLevel: 'error',
    discordClientId: 'dcid',
    discordClientSecret: 'dcsecret',
    discordRedirectUri: 'https://example.com/oauth/discord/bot/callback',
    discordOauthScopes: ['bot'],
    discordOauthPermissions: 12345,
  } as any;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds authorize URL with client id, redirect, scopes and permissions from config', async () => {
    const a = new DiscordAdapter(baseCfg);
    const url = await a.getAuthorizeUrl({ identity: 'bot', state: 's1' });
    const u = new URL(url);
    expect(u.origin).toBe('https://discord.com');
    expect(u.pathname).toBe('/oauth2/authorize');
    const p = u.searchParams;
    expect(p.get('client_id')).toBe('dcid');
    expect(p.get('redirect_uri')).toBe('https://example.com/oauth/discord/bot/callback');
    expect(p.get('response_type')).toBe('code');
    expect(p.get('state')).toBe('s1');
    expect(p.get('scope')).toBe('bot');
    expect(p.get('permissions')).toBe('12345');
  });

  it('uses default scopes and permissions when not provided in config', async () => {
    const minCfg: IConfig = {
      discordClientId: 'dcid',
      discordRedirectUri: 'https://example.com/callback',
    } as any;
    const a = new DiscordAdapter(minCfg);
    const url = await a.getAuthorizeUrl({ identity: 'bot', state: 's2' });
    const u = new URL(url);
    const p = u.searchParams;
    expect(p.get('scope')).toBe('bot applications.commands identify');
    expect(p.get('permissions')).toBe('379968');
  });

  it('resolves redirect URI from architecture if not in config', async () => {
    const archCfg: IConfig = {
      discordClientId: 'dcid',
    } as any;
    const spy = jest.spyOn(BaseServer as any, 'loadArchitectureYaml').mockReturnValue({
      infrastructure: {
        resources: {
          'main-load-balancer': {
            routing: { default_domain: 'api.test.ai' },
          },
        },
      },
    });

    const a = new DiscordAdapter(archCfg);
    const url = await a.getAuthorizeUrl({ identity: 'bot', state: 's3' });
    const u = new URL(url);
    expect(u.searchParams.get('redirect_uri')).toBe('https://api.test.ai/oauth/discord/bot/callback');
    spy.mockRestore();
  });

  describe('exchangeCodeForToken', () => {
    const mockTokenResp = {
      access_token: 'at123',
      expires_in: 3600,
      refresh_token: 'rt123',
      scope: 'bot identify',
      token_type: 'Bearer',
      guild: { id: 'g123' },
      permissions: '12345',
    };

    it('exchanges code for token using fetch', async () => {
      const a = new DiscordAdapter(baseCfg);
      
      // Mock global fetch
      const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
        ok: true,
        json: async () => mockTokenResp,
      } as any);

      const result = await a.exchangeCodeForToken({ code: 'c123', identity: 'bot', redirectUri: '' });

      expect(fetchSpy).toHaveBeenCalledWith('https://discord.com/api/v10/oauth2/token', expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }));

      const lastCallBody = new URLSearchParams((fetchSpy.mock.calls[0][1] as any).body);
      expect(lastCallBody.get('grant_type')).toBe('authorization_code');
      expect(lastCallBody.get('code')).toBe('c123');
      expect(lastCallBody.get('client_id')).toBe('dcid');
      expect(lastCallBody.get('client_secret')).toBe('dcsecret');

      expect(result.accessToken).toBe('at123');
      expect(result.refreshToken).toBe('rt123');
      expect(result.metadata.guildId).toBe('g123');
      expect(result.metadata.permissions).toBe('12345');
      
      fetchSpy.mockRestore();
    });

    it('throws error when fetch fails', async () => {
      const a = new DiscordAdapter(baseCfg);
      const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      } as any);

      await expect(a.exchangeCodeForToken({ code: 'c123', identity: 'bot', redirectUri: '' }))
        .rejects.toThrow('discord_token_exchange_failed:400:Bad Request');

      fetchSpy.mockRestore();
    });
  });
});

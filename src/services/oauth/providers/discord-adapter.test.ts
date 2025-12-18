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
    expect(p.get('scope')).toBe('bot applications.commands');
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
});

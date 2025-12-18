import { TwitchAdapter } from './twitch-adapter';
import type { IConfig } from '../../../types';

jest.mock('../../twitch-oauth', () => ({
  exchangeCodeForToken: jest.fn(),
}));

describe('TwitchAdapter', () => {
  const baseCfg: IConfig = {
    port: 0,
    logLevel: 'error',
    twitchClientId: 'cid',
    twitchClientSecret: 'csecret',
    twitchRedirectUri: 'https://example.com/oauth/twitch/bot/callback',
    twitchScopes: ['chat:read', 'chat:edit'],
    twitchChannels: [],
    oauthStateSecret: 'state',
  } as any;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds authorize URL with client id, redirect and scopes', async () => {
    const a = new TwitchAdapter(baseCfg);
    const url = await a.getAuthorizeUrl({ identity: 'bot', state: 's1' });
    const u = new URL(url);
    expect(u.origin).toBe('https://id.twitch.tv');
    expect(u.pathname).toBe('/oauth2/authorize');
    const p = u.searchParams;
    expect(p.get('client_id')).toBe('cid');
    expect(p.get('redirect_uri')).toBe('https://example.com/oauth/twitch/bot/callback');
    expect(p.get('response_type')).toBe('code');
    expect(p.get('state')).toBe('s1');
    expect(p.get('scope')).toBe('chat:read chat:edit');
    expect(p.get('force_verify')).toBe('true');
  });

  it('maps exchangeCodeForToken() result to TokenPayload with expiresAt and providerUserId', async () => {
    const now = 1_700_000_000_000; // fixed epoch
    const { exchangeCodeForToken } = require('../../twitch-oauth');
    exchangeCodeForToken.mockResolvedValue({
      accessToken: 'AT',
      refreshToken: 'RT',
      scope: ['a', 'b'],
      expiresIn: 3600,
      obtainmentTimestamp: now,
      userId: '999',
    });

    const a = new TwitchAdapter(baseCfg);
    const out = await a.exchangeCodeForToken({ code: 'abc', redirectUri: '', identity: 'bot' });
    expect(exchangeCodeForToken).toHaveBeenCalledWith(baseCfg, 'abc', 'https://example.com/oauth/twitch/bot/callback');
    expect(out.accessToken).toBe('AT');
    expect(out.refreshToken).toBe('RT');
    expect(out.scope).toEqual(['a', 'b']);
    expect(out.tokenType).toBe('oauth');
    expect(out.providerUserId).toBe('999');
    expect(out.expiresAt).toBe(new Date(now + 3600 * 1000).toISOString());
  });

  it('refreshAccessToken posts to Twitch token endpoint and maps response', async () => {
    const fixedNow = 1_800_000_000_000;
    const realNow = Date.now;
    // @ts-ignore
    Date.now = () => fixedNow;
    const gFetch = global.fetch as any;
    (global as any).fetch = jest.fn(async (url: string, init?: any) => {
      expect(String(url)).toContain('https://id.twitch.tv/oauth2/token');
      expect((init || {}).method).toBe('POST');
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'NAT', refresh_token: 'NRT', expires_in: 7200, scope: ['x'] }),
        text: async () => 'ok',
      } as any;
    });

    const a = new TwitchAdapter(baseCfg);
    const res = await a.refreshAccessToken({ accessToken: 'old', refreshToken: 'R1', scope: ['y'] });
    expect(res.accessToken).toBe('NAT');
    expect(res.refreshToken).toBe('NRT');
    expect(res.scope).toEqual(['x']);
    expect(res.tokenType).toBe('oauth');
    expect(typeof res.expiresAt).toBe('string');
    expect(new Date(res.expiresAt || '').getTime()).toBe(fixedNow + 7200 * 1000);

    (global as any).fetch = gFetch;
    // @ts-ignore
    Date.now = realNow;
  });

  it('refreshAccessToken throws when HTTP response not ok', async () => {
    const gFetch = global.fetch as any;
    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 400, text: async () => 'bad' }));
    const a = new TwitchAdapter(baseCfg);
    await expect(a.refreshAccessToken({ accessToken: 'old', refreshToken: 'R1' })).rejects.toThrow(/refresh_failed:400/);
    (global as any).fetch = gFetch;
  });
});

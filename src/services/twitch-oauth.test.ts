import { generateState, verifyState, getAuthUrl } from './twitch-oauth';
import type { IConfig } from '../types';
import { BaseServer } from '../common/base-server';

describe('twitch-oauth helpers', () => {
  const baseCfg: IConfig = {
    port: 3000,
    logLevel: 'debug',
    twitchEnabled: true,
    twitchClientId: 'test-client',
    twitchClientSecret: 'test-secret',
    twitchRedirectUri: undefined,
    twitchScopes: ['chat:read'],
    twitchChannels: [],
    commandWhitelist: [],
    oauthStateSecret: 'state-secret',
    firestoreEnabled: false,
  } as any;

  it('generateState and verifyState round-trip valid', () => {
    const state = generateState(baseCfg);
    expect(typeof state).toBe('string');
    expect(state.split('.').length).toBe(3);
    expect(verifyState(baseCfg, state)).toBe(true);
  });

  it('verifyState rejects tampered values', () => {
    const state = generateState(baseCfg);
    const parts = state.split('.');
    // Tamper with nonce
    parts[0] = parts[0] + 'x';
    const bad = parts.join('.');
    expect(verifyState(baseCfg, bad)).toBe(false);
  });

  it('getAuthUrl composes Twitch authorize URL with correct params', () => {
    // Ensure LB-based domain resolution is disabled for this test
    const spy = jest.spyOn(BaseServer as any, 'loadArchitectureYaml').mockReturnValue(null);
    const req: any = {
      protocol: 'http',
      get: (name: string) => {
        if (name.toLowerCase() === 'x-forwarded-proto') return 'https';
        if (name.toLowerCase() === 'x-forwarded-host') return 'example.com';
        if (name.toLowerCase() === 'host') return 'example.com';
        return undefined;
      },
      headers: {},
    };
    const url = getAuthUrl(baseCfg, req as any, '/oauth/twitch/bot');
    expect(url.startsWith('https://id.twitch.tv/oauth2/authorize?')).toBe(true);
    const u = new URL(url);
    expect(u.searchParams.get('client_id')).toBe('test-client');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toBe('chat:read');
    expect(u.searchParams.get('redirect_uri')).toBe('https://example.com/oauth/twitch/bot/callback');
    expect(u.searchParams.get('state')).toBeTruthy();
    spy.mockRestore();
  });

  it('getAuthUrl prefers architecture.yaml load balancer default_domain when present', () => {
    const spy = jest.spyOn(BaseServer as any, 'loadArchitectureYaml').mockReturnValue({
      infrastructure: {
        'main-load-balancer': {
          routing: { default_domain: 'api.test.local' },
        },
      },
    });
    const req: any = {
      protocol: 'http',
      get: (_: string) => undefined,
      headers: {},
    };
    const url = getAuthUrl(baseCfg, req as any, '/oauth/twitch/bot');
    const u = new URL(url);
    expect(u.searchParams.get('redirect_uri')).toBe('https://api.test.local/oauth/twitch/bot/callback');
    spy.mockRestore();
  });
});

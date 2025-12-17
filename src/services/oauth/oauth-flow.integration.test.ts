import express from 'express';
import request from 'supertest';

import { ProviderRegistry } from './provider-registry';
import { mountOAuthRoutes } from './routes';
import { TwitchAdapter } from './providers/twitch-adapter';
import type { IConfig } from '../../types';
import type { IAuthTokenStoreV2, AuthTokenDoc } from './auth-token-store';
import { generateState } from '../twitch-oauth';

describe('Integration: generic oauth-flow endpoints (Twitch)', () => {
  const baseCfg: IConfig = {
    port: 0,
    logLevel: 'error',
    twitchClientId: 'cid',
    twitchClientSecret: 'secret',
    twitchRedirectUri: 'https://example.com/oauth/twitch/bot/callback',
    twitchScopes: ['chat:read'],
    twitchChannels: [],
    oauthStateSecret: 'state-secret',
  } as any;

  const origFetch = global.fetch as any;
  beforeEach(() => {
    (global as any).fetch = jest.fn(async (url: string, init?: any) => {
      if (String(url).includes('/oauth2/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600, scope: ['chat:read'] }),
          text: async () => 'ok',
        } as any;
      }
      if (String(url).includes('/oauth2/validate')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ user_id: 'u-123' }),
          text: async () => 'ok',
        } as any;
      }
      throw new Error('Unexpected fetch call: ' + url);
    });
  });
  afterEach(() => {
    (global as any).fetch = origFetch;
  });

  function makeAppAndStore() {
    const app = express();
    const reg = new ProviderRegistry();
    reg.register(new TwitchAdapter(baseCfg));
    let saved: AuthTokenDoc | null = null;
    const store: IAuthTokenStoreV2 = {
      async getAuthToken(provider: string, identity: string) {
        return saved && saved.provider === provider && saved.identity === identity ? saved : null;
      },
      async putAuthToken(provider: string, identity: string, token: any) {
        saved = { provider, identity, updatedAt: new Date().toISOString(), ...(token as any) };
      },
    };
    mountOAuthRoutes(app as any, baseCfg, reg, '/oauth', store);
    return { app, storeRef: () => saved };
  }

  it('GET /oauth/twitch/bot/start redirects by default and returns JSON when mode=json', async () => {
    const { app } = makeAppAndStore();
    const resRedirect = await request(app).get('/oauth/twitch/bot/start');
    expect(resRedirect.status).toBe(302);
    expect(String(resRedirect.header.location || '')).toContain('https://id.twitch.tv/oauth2/authorize?');

    const resJson = await request(app).get('/oauth/twitch/bot/start?mode=json').set('Accept', 'application/json');
    expect(resJson.status).toBe(200);
    expect(resJson.body).toHaveProperty('url');
    expect(String(resJson.body.url)).toContain('https://id.twitch.tv/oauth2/authorize?');
  });

  it('Callback persists token and status shows present', async () => {
    const { app, storeRef } = makeAppAndStore();
    const state = generateState(baseCfg);

    const cb = await request(app)
      .get('/oauth/twitch/bot/callback')
      .query({ code: 'abc', state })
      .set('x-forwarded-proto', 'https')
      .set('x-forwarded-host', 'example.com');
    expect(cb.status).toBe(200);
    expect(cb.body).toMatchObject({ ok: true, provider: 'twitch', identity: 'bot', stored: true });

    const saved = storeRef();
    expect(saved).not.toBeNull();
    expect(saved!.accessToken).toBe('access-token');
    expect(saved!.tokenType).toBe('oauth');

    const st = await request(app).get('/oauth/twitch/bot/status');
    expect(st.status).toBe(200);
    expect(st.body).toMatchObject({ ok: true, status: 'present' });
  });
});

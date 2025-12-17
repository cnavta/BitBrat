import express from 'express';
import request from 'supertest';

import { mountOAuthRoutes } from './routes';
import { ProviderRegistry } from './provider-registry';
import type { OAuthProvider, TokenPayload } from './types';
import type { IConfig } from '../../types';
import { generateState } from '../twitch-oauth';
import type { IAuthTokenStoreV2, AuthTokenDoc } from './auth-token-store';

function makeApp(registry: ProviderRegistry, cfg: IConfig) {
  const app = express();
  // mount under default base "/oauth"
  mountOAuthRoutes(app as any, cfg, registry, '/oauth');
  return app;
}

function makeMockProvider(key = 'mockprov'): OAuthProvider {
  return {
    key,
    displayName: 'Mock Provider',
    async getAuthorizeUrl(params) {
      const id = params.identity;
      const state = params.state;
      return `https://auth.example/${id}?s=${state}`;
    },
    async exchangeCodeForToken(_params: { code: string; redirectUri: string; identity: string }): Promise<TokenPayload> {
      return { accessToken: 'AT', tokenType: 'oauth', scope: ['a'] };
    },
  };
}

const baseCfg: IConfig = {
  port: 0,
  logLevel: 'error',
  twitchScopes: [],
  twitchChannels: [],
  oauthStateSecret: 'test-secret',
};

describe('mountOAuthRoutes (generic)', () => {
  test('GET /oauth/:provider/:identity/start returns JSON url when mode=json', async () => {
    const reg = new ProviderRegistry();
    reg.register(makeMockProvider());
    const app = makeApp(reg, baseCfg);

    const res = await request(app).get('/oauth/mockprov/bot/start?mode=json').set('Accept', 'application/json');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('url');
    expect(String(res.body.url)).toMatch(/^https:\/\/auth\.example\/bot\?s=/);
  });

  test('GET /oauth/:provider/:identity/start redirects by default', async () => {
    const reg = new ProviderRegistry();
    reg.register(makeMockProvider());
    const app = makeApp(reg, baseCfg);

    const res = await request(app).get('/oauth/mockprov/bot/start');
    expect(res.status).toBe(302);
    expect(res.header.location).toMatch(/^https:\/\/auth\.example\/bot\?s=/);
  });

  test('GET /oauth/:provider/:identity/start for unknown provider returns 404', async () => {
    const reg = new ProviderRegistry();
    const app = makeApp(reg, baseCfg);

    const res = await request(app).get('/oauth/unknown/bot/start?mode=json').set('Accept', 'application/json');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
    expect(String(res.body.error)).toContain('unknown_provider');
  });

  test('GET /oauth/:provider/:identity/callback with invalid state returns 400', async () => {
    const reg = new ProviderRegistry();
    reg.register(makeMockProvider());
    const app = makeApp(reg, baseCfg);

    const res = await request(app).get('/oauth/mockprov/bot/callback?code=abc&state=bad');
    expect(res.status).toBe(400);
    expect(res.text).toContain('Invalid state');
  });

  test('GET /oauth/:provider/:identity/callback success path returns ok=true', async () => {
    const reg = new ProviderRegistry();
    reg.register(makeMockProvider());
    const app = makeApp(reg, baseCfg);
    const state = generateState(baseCfg);

    const res = await request(app).get(`/oauth/mockprov/bot/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, provider: 'mockprov', identity: 'bot', stored: false });
  });

  test('POST /oauth/:provider/:identity/refresh returns 501 when not supported', async () => {
    const reg = new ProviderRegistry();
    reg.register(makeMockProvider());
    const app = makeApp(reg, baseCfg);

    const res = await request(app).post('/oauth/mockprov/bot/refresh');
    expect(res.status).toBe(501);
    expect(res.body).toMatchObject({ error: 'not_supported' });
  });

  test('GET /oauth/:provider/:identity/status returns absent when no token in store', async () => {
    const reg = new ProviderRegistry();
    reg.register(makeMockProvider());
    const app = express();
    const emptyStore: IAuthTokenStoreV2 = {
      async getAuthToken() { return null; },
      async putAuthToken() { /* no-op */ },
    };
    // mount with token store
    mountOAuthRoutes(app as any, baseCfg, reg, '/oauth', emptyStore);

    const res = await request(app).get('/oauth/mockprov/bot/status');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: 'absent' });
  });

  test('Callback persists token to store and status shows present', async () => {
    const reg = new ProviderRegistry();
    reg.register(makeMockProvider());
    const app = express();
    let saved: AuthTokenDoc | null = null;
    const memStore: IAuthTokenStoreV2 = {
      async getAuthToken(provider: string, identity: string) {
        return (saved && saved.provider === provider && saved.identity === identity) ? saved : null;
      },
      async putAuthToken(provider: string, identity: string, token: any) {
        saved = { provider, identity, updatedAt: new Date().toISOString(), ...(token as any) };
      },
    };
    mountOAuthRoutes(app as any, baseCfg, reg, '/oauth', memStore);
    const state = generateState(baseCfg);

    const cb = await request(app).get(`/oauth/mockprov/bot/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(cb.status).toBe(200);
    expect(cb.body).toMatchObject({ ok: true, provider: 'mockprov', identity: 'bot', stored: true });

    const statusRes = await request(app).get('/oauth/mockprov/bot/status');
    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toMatchObject({ ok: true, status: 'present' });
  });
});

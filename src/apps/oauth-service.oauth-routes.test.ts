import request from 'supertest';
import { createApp } from './oauth-service';
import type { ITokenStore, TwitchTokenData, IConfig } from '../types';
import { generateState } from '../services/twitch-oauth';

class MemoryTokenStore implements ITokenStore {
  public value: TwitchTokenData | null = null;
  async getToken(): Promise<TwitchTokenData | null> {
    return this.value;
  }
  async setToken(token: TwitchTokenData): Promise<void> {
    this.value = token;
  }
}

describe('oauth-service OAuth routes', () => {
  const cfg: Partial<IConfig> = {
    twitchClientId: 'test-client',
    twitchClientSecret: 'test-secret',
    oauthStateSecret: 'state-secret',
    twitchScopes: ['chat:read', 'chat:edit'],
  } as any;

  const botStore = new MemoryTokenStore();
  const broadcasterStore = new MemoryTokenStore();
  const app = createApp({ botStore, broadcasterStore, config: cfg });

  const origFetch = global.fetch as any;
  beforeEach(() => {
    (global as any).fetch = jest.fn(async (url: string, init?: any) => {
      if (String(url).includes('/oauth2/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            expires_in: 14400,
            scope: ['chat:read'],
          }),
          text: async () => 'ok',
        } as any;
      }
      if (String(url).includes('/oauth2/validate')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ user_id: '999' }),
          text: async () => 'ok',
        } as any;
      }
      throw new Error('Unexpected fetch call: ' + url);
    });
  });
  afterEach(() => {
    (global as any).fetch = origFetch;
    botStore.value = null;
    broadcasterStore.value = null;
  });

  it('GET /oauth/twitch/bot/start returns JSON url when mode=json', async () => {
    const res = await request(app)
      .get('/oauth/twitch/bot/start')
      .set('Accept', 'application/json')
      .query({ mode: 'json' })
      .set('x-forwarded-proto', 'https')
      .set('x-forwarded-host', 'example.com');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('url');
    expect(String(res.body.url)).toContain('https://id.twitch.tv/oauth2/authorize?');
  });

  it('GET /oauth/twitch/bot/callback exchanges code and stores token', async () => {
    const fullCfg = { ...(cfg as any), port: 0, logLevel: 'debug', twitchEnabled: true, firestoreEnabled: false } as IConfig;
    const state = generateState(fullCfg);
    const res = await request(app)
      .get('/oauth/twitch/bot/callback')
      .query({ code: 'abc', state })
      .set('x-forwarded-proto', 'https')
      .set('x-forwarded-host', 'example.com');
    expect(res.status).toBe(200);
    expect(botStore.value?.accessToken).toBe('access-token');
    expect(botStore.value?.userId).toBe('999');
  });

  it('GET /oauth/twitch/broadcaster/callback exchanges code and stores token', async () => {
    const fullCfg = { ...(cfg as any), port: 0, logLevel: 'debug', twitchEnabled: true, firestoreEnabled: false } as IConfig;
    const state = generateState(fullCfg);
    const res = await request(app)
      .get('/oauth/twitch/broadcaster/callback')
      .query({ code: 'xyz', state })
      .set('x-forwarded-proto', 'https')
      .set('x-forwarded-host', 'example.com');
    expect(res.status).toBe(200);
    expect(broadcasterStore.value?.accessToken).toBe('access-token');
    expect(broadcasterStore.value?.userId).toBe('999');
  });
});

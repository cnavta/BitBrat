import { TwitchTokenManager } from './twitch-token-manager';
import { ITokenStore, TwitchTokenData } from '../types';

class MemoryTokenStore implements ITokenStore {
  constructor(private token: TwitchTokenData | null) {}
  async getToken(): Promise<TwitchTokenData | null> { return this.token; }
  async setToken(token: TwitchTokenData): Promise<void> { this.token = token; }
}

describe('TwitchTokenManager', () => {
  const origFetch = global.fetch as any;

  afterEach(() => {
    global.fetch = origFetch;
    jest.restoreAllMocks();
  });

  test('returns current token when not expired', async () => {
    const now = Date.now();
    const store = new MemoryTokenStore({
      accessToken: 'old',
      refreshToken: 'r1',
      expiresIn: 3600,
      obtainmentTimestamp: now,
      scope: [],
    });
    const mgr = new TwitchTokenManager({ clientId: 'cid', clientSecret: 'sec', tokenStore: store, skewSeconds: 60 });
    const tok = await mgr.getValidAccessToken();
    expect(tok).toBe('old');
  });

  test('refreshes token when expired', async () => {
    const past = Date.now() - 7200 * 1000; // 2h ago
    const store = new MemoryTokenStore({
      accessToken: 'old',
      refreshToken: 'r1',
      expiresIn: 3600,
      obtainmentTimestamp: past,
      scope: [],
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'newtok', refresh_token: 'r2', expires_in: 3600, scope: [] }),
    });
    const mgr = new TwitchTokenManager({ clientId: 'cid', clientSecret: 'sec', tokenStore: store, skewSeconds: 60 });
    const tok = await mgr.getValidAccessToken();
    expect(tok).toBe('newtok');
    const saved = await store.getToken();
    expect(saved?.accessToken).toBe('newtok');
    expect(saved?.refreshToken).toBe('r2');
  });

  test('keeps current token when refresh fails', async () => {
    const past = Date.now() - 7200 * 1000;
    const store = new MemoryTokenStore({
      accessToken: 'old',
      refreshToken: 'r1',
      expiresIn: 3600,
      obtainmentTimestamp: past,
      scope: [],
    });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'bad' });
    const mgr = new TwitchTokenManager({ clientId: 'cid', clientSecret: 'sec', tokenStore: store, skewSeconds: 60 });
    const tok = await mgr.getValidAccessToken();
    expect(tok).toBe('old');
  });
});

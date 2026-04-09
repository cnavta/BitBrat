import { FirestoreAuthTokenStore } from './auth-token-store';

function makeDb(stubs: Record<string, any>) {
  return {
    doc: (path: string) => {
      const existing = stubs[path];
      if (existing) return existing;
      // default stub: empty doc
      return {
        async get() { return { exists: false, data: () => ({}) }; },
        async set() { /* no-op */ },
      };
    },
  } as any;
}

describe('FirestoreAuthTokenStore', () => {
  it('returns null when doc missing', async () => {
    const path = 'oauth/twitch/bot/token';
    const stubs: Record<string, any> = {
      [path]: { async get() { return { exists: false, data: () => ({}) }; }, async set() {} },
    };
    const store = new FirestoreAuthTokenStore({ db: makeDb(stubs) as any });
    const doc = await store.getAuthToken('twitch', 'bot');
    expect(doc).toBeNull();
  });

  it('reads doc and maps to AuthTokenDoc', async () => {
    const path = 'oauth/twitch/bot/token';
    const payload = {
      tokenType: 'oauth',
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: '2025-01-01T00:00:00.000Z',
      scope: ['s'],
      providerUserId: 'uid',
      metadata: { a: 1 },
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    const stubs: Record<string, any> = {
      [path]: { async get() { return { exists: true, data: () => ({ ...payload }) }; }, async set() {} },
    };
    const store = new FirestoreAuthTokenStore({ db: makeDb(stubs) as any });
    const doc = await store.getAuthToken('twitch', 'bot');
    expect(doc).not.toBeNull();
    expect(doc!.provider).toBe('twitch');
    expect(doc!.identity).toBe('bot');
    expect(doc!.accessToken).toBe('AT');
    expect(doc!.tokenType).toBe('oauth');
    expect(doc!.scope).toEqual(['s']);
    expect(doc!.providerUserId).toBe('uid');
  });

  it('putAuthToken writes to oauth/provider/identity/token with updatedAt ISO', async () => {
    const path = 'oauth/discord/bot/token';
    const setCalls: any[] = [];
    const stubs: Record<string, any> = {
      [path]: {
        async get() { return { exists: false, data: () => ({}) }; },
        async set(data: any, opts: any) { setCalls.push({ data, opts }); },
      },
    };
    const store = new FirestoreAuthTokenStore({ db: makeDb(stubs) as any });
    await store.putAuthToken('discord', 'bot', { tokenType: 'bot-token', accessToken: 'X', scope: ['bot'] });
    expect(setCalls.length).toBe(1);
    const d = setCalls[0].data;
    expect(d.provider).toBe('discord');
    expect(d.identity).toBe('bot');
    expect(d.tokenType).toBe('bot-token');
    expect(d.accessToken).toBe('X');
    expect(typeof d.updatedAt).toBe('string');
  });

  it('maps Twitch legacy schema (obtainmentTimestamp/expiresIn/userId)', async () => {
    const path = 'oauth/twitch/broadcaster/token';
    const legacy = {
      accessToken: 'AT_LEGACY',
      refreshToken: 'RT_LEGACY',
      expiresIn: 3600,
      obtainmentTimestamp: 1_700_000_000_000,
      scope: ['c'],
      userId: 'u_legacy',
    };
    const stubs: Record<string, any> = {
      [path]: { async get() { return { exists: true, data: () => ({ ...legacy }) }; }, async set() {} },
    };
    const store = new FirestoreAuthTokenStore({ db: makeDb(stubs) as any });
    const doc = await store.getAuthToken('twitch', 'broadcaster');
    expect(doc).not.toBeNull();
    expect(doc!.accessToken).toBe('AT_LEGACY');
    expect(doc!.providerUserId).toBe('u_legacy');
    expect(doc!.expiresAt).toBe(new Date(1_700_000_000_000 + 3600 * 1000).toISOString());
  });
});

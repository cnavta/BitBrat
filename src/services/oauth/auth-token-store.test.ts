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

describe('FirestoreAuthTokenStore (V2)', () => {
  it('returns null when v2 doc missing and no legacy configured', async () => {
    const v2Path = 'authTokens/twitch/bot';
    const stubs: Record<string, any> = {
      [v2Path]: { async get() { return { exists: false, data: () => ({}) }; }, async set() {} },
    };
    const store = new FirestoreAuthTokenStore({ db: makeDb(stubs) as any });
    const doc = await store.getAuthToken('twitch', 'bot');
    expect(doc).toBeNull();
  });

  it('reads v2 doc and maps to AuthTokenDoc', async () => {
    const v2Path = 'authTokens/twitch/bot';
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
      [v2Path]: { async get() { return { exists: true, data: () => ({ ...payload }) }; }, async set() {} },
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

  it('putAuthToken writes v2 doc with updatedAt ISO', async () => {
    const v2Path = 'authTokens/discord/bot';
    const setCalls: any[] = [];
    const stubs: Record<string, any> = {
      [v2Path]: {
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
    expect(Number.isNaN(Date.parse(d.updatedAt))).toBe(false);
  });

  it('legacy read-compat maps Twitch legacy schema when v2 missing', async () => {
    const v2Path = 'authTokens/twitch/broadcaster/token';
    const legacyPath = 'oauth/twitch/broadcaster/token';
    const legacy = {
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresIn: 3600,
      obtainmentTimestamp: 1_700_000_000_000,
      scope: ['c'],
      userId: 'u2',
    };
    const stubs: Record<string, any> = {
      [v2Path]: { async get() { return { exists: false, data: () => ({}) }; }, async set() {} },
      [legacyPath]: { async get() { return { exists: true, data: () => ({ ...legacy }) }; }, async set() {} },
    };
    const store = new FirestoreAuthTokenStore({ db: makeDb(stubs) as any, legacyFallback: { twitch: { broadcaster: 'oauth/twitch/broadcaster' } } });
    const doc = await store.getAuthToken('twitch', 'broadcaster');
    expect(doc).not.toBeNull();
    expect(doc!.tokenType).toBe('oauth');
    expect(doc!.accessToken).toBe('AT');
    expect(doc!.providerUserId).toBe('u2');
    expect(doc!.expiresAt).toBe(new Date(1_700_000_000_000 + 3600 * 1000).toISOString());
  });
});

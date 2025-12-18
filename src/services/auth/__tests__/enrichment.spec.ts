import { enrichEvent } from '../enrichment';
import type { UserRepo, AuthUserDoc } from '../user-repo';
import type { InternalEventV2 } from '../../../types/events';

function makeEvent(partial?: Partial<InternalEventV2>): InternalEventV2 {
  return {
    v: '1',
    source: 'ingress.twitch',
    correlationId: 'c-1',
    type: 'chat.message.v1',
    message: { id: 'm1', role: 'user', text: 'hi', rawPlatformPayload: {} },
    ...(partial || {}),
  } as InternalEventV2;
}

describe('enrichEvent()', () => {
  const fixedNow = () => '2025-01-01T00:00:00.000Z';

  test('matched by id populates user and auth.matched=true', async () => {
    const repo: UserRepo = {
      getById: async (id: string) => ({ id, email: 'a@b.c', displayName: 'Alice' } as AuthUserDoc),
      getByEmail: async () => null,
    };
    const evt = makeEvent({ correlationId: 'c-2', user: { id: 'u-1' } as any });
    const res = await enrichEvent(evt, repo, { now: fixedNow, provider: 'twitch' });
    expect(res.matched).toBe(true);
    expect(res.userRef).toBe('users/twitch:u-1');
    expect((res.event as any).user).toEqual({ id: 'twitch:u-1', email: 'a@b.c', displayName: 'Alice' });
    expect((res.event as any).auth).toEqual({ v: '1', method: 'enrichment', matched: true, at: fixedNow(), provider: 'twitch', userRef: 'users/twitch:u-1' });
  });

  test('fallback to email when id not found', async () => {
    const repo: UserRepo = {
      getById: async () => null,
      getByEmail: async (email: string) => ({ id: 'u-2', email, displayName: 'Bob' } as AuthUserDoc),
    };
    const evt = makeEvent({ correlationId: 'c-3', user: { email: 'b@c.d' } as any });
    const res = await enrichEvent(evt, repo, { now: fixedNow });
    expect(res.matched).toBe(true);
    expect(res.userRef).toBe('users/u-2');
    expect((res.event as any).user).toEqual({ id: 'u-2', email: 'b@c.d', displayName: 'Bob' });
    expect((res.event as any).auth?.matched).toBe(true);
  });

  test('unmatched sets auth.matched=false and preserves envelope', async () => {
    const repo: UserRepo = {
      getById: async () => null,
      getByEmail: async () => null,
    };
    const evt = makeEvent({ correlationId: 'c-4' });
    const res = await enrichEvent(evt, repo, { now: fixedNow });
    expect(res.matched).toBe(false);
    expect(res.userRef).toBeUndefined();
    expect((res.event as any).auth).toEqual({ v: '1', method: 'enrichment', matched: false, at: fixedNow() });
  });

  test('creates new user and sets tags when repo supports ensureUserOnMessage', async () => {
    const createdDoc: AuthUserDoc = { id: 'twitch:u-9', displayName: 'Newbie' } as any;
    const repo: UserRepo = {
      getById: async () => null,
      getByEmail: async () => null,
      // @ts-ignore optional method for test
      ensureUserOnMessage: async () => ({ doc: createdDoc, created: true, isFirstMessage: true, isNewSession: true }),
    } as any;
    const evt = makeEvent({ correlationId: 'c-5', user: { id: 'u-9' } as any, source: 'ingress.twitch' } as any);
    const res = await enrichEvent(evt, repo, { now: fixedNow, provider: 'twitch' });
    expect(res.matched).toBe(true);
    expect(res.userRef).toBe('users/twitch:u-9');
    const userOut: any = (res.event as any).user;
    expect(userOut.id).toBe('twitch:u-9');
    expect(Array.isArray(userOut.tags)).toBe(true);
    expect(userOut.tags).toEqual(expect.arrayContaining(['NEW_USER', 'FIRST_ALLTIME_MESSAGE', 'FIRST_SESSION_MESSAGE', 'PROVIDER_TWITCH']));
    expect((res.event as any).auth).toEqual({ v: '1', method: 'enrichment', matched: true, at: fixedNow(), provider: 'twitch', userRef: 'users/twitch:u-9' });
  });
});

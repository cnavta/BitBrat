import { enrichEvent } from '../enrichment';
import type { UserRepo, AuthUserDoc } from '../user-repo';
import type { InternalEventV1 } from '../../../types/events';

function makeEvent(partial?: Partial<InternalEventV1>): InternalEventV1 {
  return {
    envelope: {
      v: '1',
      source: 'ingress.twitch',
      correlationId: 'c-1',
    },
    type: 'chat.message.v1',
    payload: {},
    ...(partial || {}),
  } as InternalEventV1;
}

describe('enrichEvent()', () => {
  const fixedNow = () => '2025-01-01T00:00:00.000Z';

  test('matched by id populates envelope.user and auth.matched=true', async () => {
    const repo: UserRepo = {
      getById: async (id: string) => ({ id, email: 'a@b.c', displayName: 'Alice' } as AuthUserDoc),
      getByEmail: async () => null,
    };
    const evt = makeEvent({ envelope: { v: '1', source: 'ingress.twitch', correlationId: 'c-2', user: { id: 'u-1' } as any } });
    const res = await enrichEvent(evt, repo, { now: fixedNow, provider: 'twitch' });
    expect(res.matched).toBe(true);
    expect(res.userRef).toBe('users/u-1');
    expect(res.event.envelope.user).toEqual({ id: 'u-1', email: 'a@b.c', displayName: 'Alice' });
    expect(res.event.envelope.auth).toEqual({ v: '1', method: 'enrichment', matched: true, at: fixedNow(), provider: 'twitch', userRef: 'users/u-1' });
  });

  test('fallback to email when id not found', async () => {
    const repo: UserRepo = {
      getById: async () => null,
      getByEmail: async (email: string) => ({ id: 'u-2', email, displayName: 'Bob' } as AuthUserDoc),
    };
    const evt = makeEvent({ envelope: { v: '1', source: 'ingress.twitch', correlationId: 'c-3', user: { email: 'b@c.d' } as any } });
    const res = await enrichEvent(evt, repo, { now: fixedNow });
    expect(res.matched).toBe(true);
    expect(res.userRef).toBe('users/u-2');
    expect(res.event.envelope.user).toEqual({ id: 'u-2', email: 'b@c.d', displayName: 'Bob' });
    expect(res.event.envelope.auth?.matched).toBe(true);
  });

  test('unmatched sets auth.matched=false and preserves envelope', async () => {
    const repo: UserRepo = {
      getById: async () => null,
      getByEmail: async () => null,
    };
    const evt = makeEvent({ envelope: { v: '1', source: 'ingress.twitch', correlationId: 'c-4' } });
    const res = await enrichEvent(evt, repo, { now: fixedNow });
    expect(res.matched).toBe(false);
    expect(res.userRef).toBeUndefined();
    expect(res.event.envelope.auth).toEqual({ v: '1', method: 'enrichment', matched: false, at: fixedNow() });
  });
});

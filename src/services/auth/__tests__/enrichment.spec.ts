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
      getById: async (id: string) => ({ id, email: 'a@b.c', displayName: 'Alice', roles: [] } as AuthUserDoc),
      getByEmail: async () => null,
    };
    const evt = makeEvent({ correlationId: 'c-2', user: { id: 'u-1' } as any });
    const res = await enrichEvent(evt, repo, { now: fixedNow, provider: 'twitch' });
    expect(res.matched).toBe(true);
    expect(res.userRef).toBe('users/twitch:u-1');
    expect((res.event as any).user).toEqual({ id: 'twitch:u-1', email: 'a@b.c', displayName: 'Alice', roles: [] });
    expect((res.event as any).auth).toEqual({ v: '1', method: 'enrichment', matched: true, at: fixedNow(), provider: 'twitch', userRef: 'users/twitch:u-1' });
  });

  test('fallback to email when id not found', async () => {
    const repo: UserRepo = {
      getById: async () => null,
      getByEmail: async (email: string) => ({ id: 'u-2', email, displayName: 'Bob', roles: [] } as AuthUserDoc),
    };
    const evt = makeEvent({ correlationId: 'c-3', user: { email: 'b@c.d' } as any });
    const res = await enrichEvent(evt, repo, { now: fixedNow });
    expect(res.matched).toBe(true);
    expect(res.userRef).toBe('users/u-2');
    expect((res.event as any).user).toEqual({ id: 'u-2', email: 'b@c.d', displayName: 'Bob', roles: [] });
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
    const createdDoc: AuthUserDoc = { id: 'twitch:u-9', displayName: 'Newbie', roles: [] } as any;
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

  test('maps Twitch mod and subscriber flags correctly', async () => {
    const repo: UserRepo = {
      getById: async () => null,
      getByEmail: async () => null,
      ensureUserOnMessage: async (id, data) => ({
        doc: { id, ...data, roles: data.roles || [] } as any,
        created: true,
        isFirstMessage: true,
        isNewSession: true
      }),
    };
    const evt = makeEvent({
      message: {
        id: 'm-twitch',
        role: 'user',
        text: 'hello',
        rawPlatformPayload: {
          isMod: true,
          isSubscriber: true,
          badges: ['vip'],
          user: { login: 'alice', displayName: 'Alice' }
        }
      } as any,
      userId: '123'
    });

    const res = await enrichEvent(evt, repo, { now: fixedNow, provider: 'twitch' });
    expect(res.matched).toBe(true);
    const userOut = (res.event as any).user;
    expect(userOut.roles).toEqual(expect.arrayContaining(['moderator', 'subscriber', 'vip']));
    expect(userOut.rolesMeta.twitch).toEqual(expect.arrayContaining(['moderator', 'subscriber', 'vip']));
    expect(userOut.profile.username).toBe('alice');
  });

  test('maps Discord roles and owner correctly', async () => {
    process.env.DISCORD_MOD_ROLES = 'AdminRole,ModRole';
    const repo: UserRepo = {
      getById: async () => null,
      getByEmail: async () => null,
      ensureUserOnMessage: async (id, data) => ({
        doc: { id, ...data, roles: data.roles || [] } as any,
        created: true,
        isFirstMessage: true,
        isNewSession: true
      }),
    };
    const evt = makeEvent({
      message: {
        id: 'm-discord',
        role: 'user',
        text: 'hello',
        rawPlatformPayload: {
          authorName: 'bob',
          roles: ['ModRole', 'SomeOtherRole'],
          isOwner: true
        }
      } as any,
      userId: '456'
    });

    const res = await enrichEvent(evt, repo, { now: fixedNow, provider: 'discord' });
    expect(res.matched).toBe(true);
    const userOut = (res.event as any).user;
    expect(userOut.roles).toEqual(expect.arrayContaining(['moderator', 'broadcaster']));
    expect(userOut.rolesMeta.discord).toEqual(expect.arrayContaining(['ModRole', 'SomeOtherRole', 'owner']));
    expect(userOut.profile.username).toBe('bob');
  });

  test('resolves candidate from externalEvent follow', async () => {
    const repo: UserRepo = {
      getById: async (id: string) => ({ id, email: 'follow@twitch.tv', displayName: 'Follower', roles: [] } as AuthUserDoc),
      getByEmail: async () => null,
    };
    const evt: any = {
      v: '1',
      source: 'ingress.twitch.eventsub',
      correlationId: 'c-follow',
      type: 'twitch.eventsub.v1',
      externalEvent: {
        kind: 'channel.follow',
        payload: { userId: 'follow-123', userLogin: 'follower', userDisplayName: 'Follower' }
      }
    };
    const res = await enrichEvent(evt, repo, { now: fixedNow, provider: 'twitch' });
    expect(res.matched).toBe(true);
    expect(res.userRef).toBe('users/twitch:follow-123');
    expect((res.event as any).user.displayName).toBe('Follower');
  });

  test('resolves candidate from externalEvent update (broadcaster)', async () => {
    const repo: UserRepo = {
      getById: async (id: string) => ({ id, email: 'host@twitch.tv', displayName: 'TheHost', roles: [] } as AuthUserDoc),
      getByEmail: async () => null,
    };
    const evt: any = {
      v: '1',
      source: 'ingress.twitch.eventsub',
      correlationId: 'c-update',
      type: 'twitch.eventsub.v1',
      externalEvent: {
        kind: 'channel.update',
        payload: { broadcasterId: 'host-999', broadcasterLogin: 'thehost', broadcasterDisplayName: 'TheHost' }
      }
    };
    const res = await enrichEvent(evt, repo, { now: fixedNow, provider: 'twitch' });
    expect(res.matched).toBe(true);
    expect(res.userRef).toBe('users/twitch:host-999');
    expect((res.event as any).user.displayName).toBe('TheHost');
  });

  test('maps Twilio message correctly', async () => {
    const repo: UserRepo = {
      getById: async () => null,
      getByEmail: async () => null,
      ensureUserOnMessage: async (id, data) => ({
        doc: { id, ...data, roles: data.roles || [] } as any,
        created: true,
        isFirstMessage: true,
        isNewSession: true
      }),
    };
    const evt = makeEvent({
      v: '1',
      source: 'ingress.twilio',
      correlationId: 'c-twilio',
      type: 'chat.message.v1',
      userId: '+1234567890',
      message: {
        id: 'msg-twilio',
        role: 'user',
        text: 'hello from sms',
        rawPlatformPayload: {
          author: '+1234567890',
          conversationSid: 'CH123'
        }
      } as any
    });

    const res = await enrichEvent(evt, repo, { now: fixedNow, provider: 'twilio' });
    expect(res.matched).toBe(true);
    const userOut = (res.event as any).user;
    expect(userOut.id).toBe('twilio:+1234567890');
    expect(userOut.displayName).toBe('+1234567890');
    expect(userOut.profile.username).toBe('+1234567890');
    expect(userOut.profile.conversationSid).toBe('CH123');
  });
});

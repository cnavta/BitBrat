import { enrichEvent } from '../enrichment';
import type { UserRepo, AuthUserDoc } from '../user-repo';
import type { InternalEventV2 } from '../../../types/events';

function makeEvent(partial?: Partial<InternalEventV2>): InternalEventV2 {
  return {
    v: '2',
    correlationId: 'c-1',
    type: 'chat.message.v1',
    ingress: {
      ingressAt: '2026-01-29T22:00:00Z',
      source: 'ingress.twitch',
    },
    identity: {
      external: {
        id: 'u-1',
        platform: 'twitch',
      }
    },
    egress: { destination: 'test' },
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
      searchUsers: async () => [],
      updateUser: async () => ({ id: 'u-1', roles: [] } as any),
    };
    const evt = makeEvent({ correlationId: 'c-2' });
    const res = await enrichEvent(evt, repo, { now: fixedNow, provider: 'twitch' });
    expect(res.matched).toBe(true);
    expect(res.userRef).toBe('users/twitch:u-1');
    expect(res.event.identity.user).toEqual({ id: 'twitch:u-1', email: 'a@b.c', displayName: 'Alice', roles: [] });
    expect(res.event.identity.auth).toEqual({ v: '2', method: 'enrichment', matched: true, at: fixedNow(), provider: 'twitch', userRef: 'users/twitch:u-1' });
  });

  test('fallback to email when id not found', async () => {
    const repo: UserRepo = {
      getById: async () => null,
      getByEmail: async (email: string) => ({ id: 'u-2', email, displayName: 'Bob', roles: [] } as AuthUserDoc),
      searchUsers: async () => [],
      updateUser: async () => ({ id: 'u-2', roles: [] } as any),
    };
    const evt = makeEvent({ 
      correlationId: 'c-3', 
      identity: { 
        external: { id: 'u-2', platform: 'test', metadata: { email: 'b@c.d' } } 
      } 
    });
    const res = await enrichEvent(evt, repo, { now: fixedNow });
    expect(res.matched).toBe(true);
    expect(res.userRef).toBe('users/u-2');
    expect(res.event.identity.user).toEqual({ id: 'u-2', email: 'b@c.d', displayName: 'Bob', roles: [] });
    expect(res.event.identity.auth?.matched).toBe(true);
  });

  test('unmatched sets auth.matched=false and preserves envelope', async () => {
    const repo: UserRepo = {
      getById: async () => null,
      getByEmail: async () => null,
      searchUsers: async () => [],
      updateUser: async () => ({ id: 'u-x', roles: [] } as any),
    };
    const evt = makeEvent({ correlationId: 'c-4' });
    const res = await enrichEvent(evt, repo, { now: fixedNow });
    expect(res.matched).toBe(false);
    expect(res.userRef).toBeUndefined();
    expect(res.event.identity.auth).toEqual({ v: '2', method: 'enrichment', matched: false, at: fixedNow(), provider: 'twitch' });
  });

  test('creates new user and sets tags when repo supports ensureUserOnMessage', async () => {
    const createdDoc: AuthUserDoc = { id: 'twitch:u-9', displayName: 'Newbie', roles: [] } as any;
    const repo: UserRepo = {
      getById: async () => null,
      getByEmail: async () => null,
      searchUsers: async () => [],
      updateUser: async () => ({ id: 'u-x', roles: [] } as any),
      // @ts-ignore optional method for test
      ensureUserOnMessage: async () => ({ doc: createdDoc, created: true, isFirstMessage: true, isNewSession: true }),
    } as any;
    const evt = makeEvent({ 
      correlationId: 'c-5', 
      identity: { 
        external: { id: 'u-9', platform: 'twitch' } 
      } 
    });
    const res = await enrichEvent(evt, repo, { now: fixedNow, provider: 'twitch' });
    expect(res.matched).toBe(true);
    expect(res.userRef).toBe('users/twitch:u-9');
    const userOut = res.event.identity.user!;
    expect(userOut.id).toBe('twitch:u-9');
    expect(Array.isArray(userOut.tags)).toBe(true);
    expect(userOut.tags).toEqual(expect.arrayContaining(['NEW_USER', 'FIRST_ALLTIME_MESSAGE', 'FIRST_SESSION_MESSAGE', 'PROVIDER_TWITCH']));
    expect(res.event.identity.auth).toEqual({ v: '2', method: 'enrichment', matched: true, at: fixedNow(), provider: 'twitch', userRef: 'users/twitch:u-9' });
  });

  test('maps Twitch mod and subscriber flags correctly', async () => {
    const repo: UserRepo = {
      getById: async () => null,
      getByEmail: async () => null,
      searchUsers: async () => [],
      updateUser: async () => ({ id: 'u-x', roles: [] } as any),
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
      identity: {
        external: { id: '123', platform: 'twitch' }
      }
    });

    const res = await enrichEvent(evt, repo, { now: fixedNow, provider: 'twitch' });
    expect(res.matched).toBe(true);
    const userOut = res.event.identity.user!;
    expect(userOut.roles).toEqual(expect.arrayContaining(['moderator', 'subscriber', 'vip']));
    expect((userOut as any).rolesMeta.twitch).toEqual(expect.arrayContaining(['moderator', 'subscriber', 'vip']));
    expect((userOut as any).profile.username).toBe('alice');
  });

  test('maps Twilio metadata correctly', async () => {
    const repo: UserRepo = {
      getById: async () => null,
      getByEmail: async () => null,
      searchUsers: async () => [],
      updateUser: async () => ({ id: 'u-x', roles: [] } as any),
      ensureUserOnMessage: async (id, data) => ({
        doc: { id, ...data, roles: data.roles || [] } as any,
        created: true,
        isFirstMessage: true,
        isNewSession: true
      }),
    };
    const evt = makeEvent({
      ingress: {
        ingressAt: '2026-01-29T22:00:00Z',
        source: 'ingress.twilio',
      },
      identity: {
        external: { id: '+1234567890', platform: 'twilio' }
      },
      message: {
        id: 'm-twilio',
        role: 'user',
        text: 'hello',
        rawPlatformPayload: {
          author: '+1234567890',
          conversationSid: 'CH123',
          participant: {
            sid: 'PA123',
            friendlyName: 'John Doe',
            channelType: 'sms',
            attributes: { location: 'NYC' }
          }
        }
      } as any
    });

    const res = await enrichEvent(evt, repo, { now: fixedNow, provider: 'twilio' });
    expect(res.matched).toBe(true);
    const userOut = res.event.identity.user!;
    expect(userOut.displayName).toBe('John Doe');
    expect((userOut as any).profile.username).toBe('+1234567890');
    expect((userOut as any).profile.channelType).toBe('sms');
    expect((userOut as any).profile.conversationSid).toBe('CH123');
    expect((userOut as any).profile.twilioParticipantSid).toBe('PA123');
    expect((userOut as any).profile.twilioAttributes).toEqual({ location: 'NYC' });
  });

  test('maps Discord roles and owner correctly', async () => {
    process.env.DISCORD_MOD_ROLES = 'AdminRole,ModRole';
    const repo: UserRepo = {
      getById: async () => null,
      getByEmail: async () => null,
      searchUsers: async () => [],
      updateUser: async () => ({ id: 'u-x', roles: [] } as any),
      ensureUserOnMessage: async (id, data) => ({
        doc: { id, ...data, roles: data.roles || [] } as any,
        created: true,
        isFirstMessage: true,
        isNewSession: true
      }),
    };
    const evt = makeEvent({
      identity: {
        external: { id: '456', platform: 'discord' }
      },
      message: {
        id: 'm-discord',
        role: 'user',
        text: 'hello',
        rawPlatformPayload: {
          authorName: 'bob',
          roles: ['ModRole', 'SomeOtherRole'],
          isOwner: true
        }
      } as any
    });

    const res = await enrichEvent(evt, repo, { now: fixedNow, provider: 'discord' });
    expect(res.matched).toBe(true);
    const userOut = res.event.identity.user!;
    expect(userOut.roles).toEqual(expect.arrayContaining(['moderator', 'broadcaster']));
    expect((userOut as any).rolesMeta.discord).toEqual(expect.arrayContaining(['ModRole', 'SomeOtherRole', 'owner']));
    expect((userOut as any).profile.username).toBe('bob');
  });

  test('resolves candidate from externalEvent follow', async () => {
    const repo: UserRepo = {
      getById: async (id: string) => ({ id, email: 'follow@twitch.tv', displayName: 'Follower', roles: [] } as AuthUserDoc),
      getByEmail: async () => null,
      searchUsers: async () => [],
      updateUser: async () => ({ id: 'u-x', roles: [] } as any),
    };
    const evt: any = {
      v: '2',
      ingress: {
        ingressAt: '2026-01-29T22:00:00Z',
        source: 'ingress.twitch.eventsub',
      },
      identity: {
        external: { id: 'u1', platform: 'twitch' }
      },
      correlationId: 'c-follow',
      type: 'twitch.eventsub.v1',
      externalEvent: {
        kind: 'channel.follow',
        metadata: { userId: 'follow-123', userLogin: 'follower', userDisplayName: 'Follower' }
      }
    };
    const res = await enrichEvent(evt, repo, { now: fixedNow, provider: 'twitch' });
    expect(res.matched).toBe(true);
    expect(res.userRef).toBe('users/twitch:follow-123');
    expect(res.event.identity.user!.displayName).toBe('Follower');
  });

  test('resolves candidate from externalEvent update (broadcaster)', async () => {
    const repo: UserRepo = {
      getById: async (id: string) => ({ id, email: 'host@twitch.tv', displayName: 'TheHost', roles: [] } as AuthUserDoc),
      getByEmail: async () => null,
      searchUsers: async () => [],
      updateUser: async () => ({ id: 'u-x', roles: [] } as any),
    };
    const evt: any = {
      v: '2',
      ingress: {
        ingressAt: '2026-01-29T22:00:00Z',
        source: 'ingress.twitch.eventsub',
      },
      identity: {
        external: { id: 'u1', platform: 'twitch' }
      },
      correlationId: 'c-update',
      type: 'twitch.eventsub.v1',
      externalEvent: {
        kind: 'channel.update',
        metadata: { broadcasterId: 'host-999', broadcasterLogin: 'thehost', broadcasterDisplayName: 'TheHost' }
      }
    };
    const res = await enrichEvent(evt, repo, { now: fixedNow, provider: 'twitch' });
    expect(res.matched).toBe(true);
    expect(res.userRef).toBe('users/twitch:host-999');
    expect(res.event.identity.user!.displayName).toBe('TheHost');
  });

  test('maps Twilio message correctly', async () => {
    const repo: UserRepo = {
      getById: async () => null,
      getByEmail: async () => null,
      searchUsers: async () => [],
      updateUser: async () => ({ id: 'u-x', roles: [] } as any),
      ensureUserOnMessage: async (id, data) => ({
        doc: { id, ...data, roles: data.roles || [] } as any,
        created: true,
        isFirstMessage: true,
        isNewSession: true
      }),
    };
    const evt = makeEvent({
      v: '2',
      ingress: {
        ingressAt: '2026-01-29T22:00:00Z',
        source: 'ingress.twilio',
      },
      identity: {
        external: { id: '+1234567890', platform: 'twilio' }
      },
      correlationId: 'c-twilio',
      type: 'chat.message.v1',
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
    const userOut = res.event.identity.user!;
    expect(userOut.id).toBe('twilio:+1234567890');
    expect(userOut.displayName).toBe('+1234567890');
    expect((userOut as any).profile.username).toBe('+1234567890');
    expect((userOut as any).profile.conversationSid).toBe('CH123');
  });
});

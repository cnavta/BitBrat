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

describe('Reproduction: VIP role missing from enriched event', () => {
  const fixedNow = () => '2025-01-01T00:00:00.000Z';

  test('VIP role in Firestore should be preserved when user chats (even if not in event payload)', async () => {
    // GIVEN a user in Firestore with 'VIP' role
    const existingDoc: AuthUserDoc = {
      id: 'twitch:u-vip',
      email: 'vip@twitch.tv',
      displayName: 'VIPUser',
      roles: ['VIP'], // Manually added as 'VIP' (uppercase)
    } as AuthUserDoc;

    const repo: UserRepo = {
      getById: async (id: string) => (id === 'twitch:u-vip' ? existingDoc : null),
      getByEmail: async () => null,
      // @ts-ignore
      ensureUserOnMessage: async (id, data) => {
        // Mocking the behavior of FirestoreUserRepo.ensureUserOnMessage
        const mergedRoles = new Set<string>(existingDoc.roles || []);
        if (data.roles) {
          data.roles.forEach((r: string) => mergedRoles.add(r));
        }
        return {
          doc: { ...existingDoc, ...data, roles: Array.from(mergedRoles) } as any,
          created: false,
          isFirstMessage: false,
          isNewSession: false
        };
      }
    } as any;

    // WHEN the user chats, and they are NOT marked as vip by the ingress (e.g. badges don't have it this time)
    const evt = makeEvent({
      userId: 'u-vip',
      message: {
        id: 'm1',
        role: 'user',
        text: 'hello',
        rawPlatformPayload: {
          badges: [], // No vip badge
          user: { login: 'vipuser', displayName: 'VIPUser' }
        }
      } as any
    });

    const res = await enrichEvent(evt, repo, { now: fixedNow, provider: 'twitch' });

    // THEN the enriched event should still have the 'VIP' role
    expect(res.matched).toBe(true);
    const userOut = (res.event as any).user;
    expect(userOut.roles).toContain('VIP');
  });

  test('VIP role should be preserved when user is matched by email and new composite doc is created', async () => {
    // GIVEN a user in Firestore with 'VIP' role, but document ID is NOT the composite ID
    const emailDoc: AuthUserDoc = {
      id: 'some-internal-id',
      email: 'vip@twitch.tv',
      displayName: 'VIPUser',
      roles: ['VIP'],
    } as AuthUserDoc;

    let firestore: Record<string, AuthUserDoc> = {
      'some-internal-id': emailDoc
    };

    const repo: UserRepo = {
      getById: async (id: string) => firestore[id] || null,
      getByEmail: async (email: string) => Object.values(firestore).find(u => u.email === email) || null,
      // @ts-ignore
      ensureUserOnMessage: async (id, data) => {
        const existing = firestore[id];
        const mergedRoles = new Set<string>(existing?.roles || []);
        if (data.roles) {
          data.roles.forEach((r: string) => mergedRoles.add(r));
        }
        const updated = { ...(existing || {}), ...data, id, roles: Array.from(mergedRoles) } as any;
        firestore[id] = updated;
        return {
          doc: updated,
          created: !existing,
          isFirstMessage: false,
          isNewSession: false
        };
      }
    } as any;

    // WHEN the user chats on Twitch
    const evt = makeEvent({
      userId: 'u-vip-123', // This will result in composite ID 'twitch:u-vip-123'
      message: {
        id: 'm1',
        role: 'user',
        text: 'hello',
        rawPlatformPayload: {
          email: 'vip@twitch.tv', // Matched by email
          user: { login: 'vipuser', displayName: 'VIPUser' }
        }
      } as any
    });

    const res = await enrichEvent(evt, repo, { now: fixedNow, provider: 'twitch' });

    // THEN the enriched event should still have the 'VIP' role
    expect(res.matched).toBe(true);
    const userOut = (res.event as any).user;
    
    // This is expected to FAIL if my hypothesis is correct
    expect(userOut.roles).toContain('VIP');
  });
});

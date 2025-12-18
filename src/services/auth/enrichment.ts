import { InternalEventV2 } from '../../types/events';
import type { UserRepo, AuthUserDoc } from './user-repo';

export interface EnrichOptions {
  provider?: string;
  now?: () => string; // returns ISO timestamp
}

function pick<T extends object>(obj: any, keys: (keyof T)[]): Partial<T> {
  const out: any = {};
  for (const k of keys as string[]) {
    if (obj && obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

function resolveCandidateId(evt: InternalEventV2): string | undefined {
  const anyEvt: any = evt as any;
  return (
    anyEvt?.user?.id ||
    (typeof anyEvt.userId === 'string' ? anyEvt.userId : undefined) ||
    anyEvt?.message?.rawPlatformPayload?.userId ||
    anyEvt?.message?.rawPlatformPayload?.user?.id ||
    undefined
  );
}

function resolveCandidateEmail(evt: InternalEventV2): string | undefined {
  const anyEvt: any = evt as any;
  const fromUser = anyEvt?.user?.email;
  if (typeof fromUser === 'string' && fromUser) return fromUser;
  const fromPayload = anyEvt?.message?.rawPlatformPayload?.user?.email || anyEvt?.message?.rawPlatformPayload?.email;
  if (typeof fromPayload === 'string' && fromPayload) return fromPayload;
  return undefined;
}

export interface EnrichResult {
  event: InternalEventV2;
  matched: boolean;
  userRef?: string;
}

/** Pure enrichment function: queries repo and returns updated event copy with envelope.user/auth set. */
export async function enrichEvent(
  event: InternalEventV2,
  repo: UserRepo,
  opts: EnrichOptions = {}
): Promise<EnrichResult> {
  const nowIso = opts.now ? opts.now() : new Date().toISOString();
  const provider = opts.provider;

  // Shallow copy event to avoid mutating caller references
  const evt: InternalEventV2 = { ...event };

  const rawId = resolveCandidateId(evt);
  const email = resolveCandidateEmail(evt);
  const compositeId = provider && rawId ? `${provider}:${rawId}` : rawId;

  let doc: AuthUserDoc | null = null;
  if (compositeId) {
    doc = await repo.getById(compositeId);
  }
  if (!doc && email) {
    doc = await repo.getByEmail(email);
  }

  // Helper to compute transient tags for this event
  const computeTags = (created: boolean, isFirstMessage: boolean, isNewSession: boolean, persistent?: string[]) => {
    const tags = new Set<string>();
    if (provider) tags.add(`PROVIDER_${provider.toUpperCase()}`);
    if (created) {
      tags.add('NEW_USER');
      tags.add('FIRST_ALLTIME_MESSAGE');
      tags.add('FIRST_SESSION_MESSAGE');
    } else {
      if (isFirstMessage) tags.add('FIRST_ALLTIME_MESSAGE');
      if (isNewSession) tags.add('FIRST_SESSION_MESSAGE');
      if (!isFirstMessage) tags.add('RETURNING_USER');
    }
    for (const t of persistent || []) tags.add(t);
    return Array.from(tags);
  };

  // Update existing user path (or fallback email match)
  if (doc) {
    // If repo can update counters/session, do it and prefer merged doc
    let created = false;
    let isFirstMessage = false;
    let isNewSession = false;
    let didEnsure = false;
    if (typeof (repo as any).ensureUserOnMessage === 'function' && compositeId) {
      try {
        const res = await (repo as any).ensureUserOnMessage(compositeId, { provider, providerUserId: rawId, email: doc.email, displayName: doc.displayName }, nowIso);
        doc = res.doc;
        created = res.created;
        isFirstMessage = res.isFirstMessage;
        isNewSession = res.isNewSession;
        didEnsure = true;
      } catch {
        // non-fatal; proceed with existing doc
      }
    }

    const effectiveDoc = doc as AuthUserDoc;
    const userOut: any = pick<AuthUserDoc>(effectiveDoc, ['id', 'email', 'displayName', 'roles', 'status', 'notes']) as any;
    if (didEnsure) {
      userOut.tags = computeTags(created, isFirstMessage, isNewSession, Array.isArray((effectiveDoc as any).tags) ? (effectiveDoc as any).tags : undefined);
    }
    (evt as any).user = userOut;
    (evt as any).auth = {
      v: '1',
      method: 'enrichment',
      matched: true,
      at: nowIso,
      ...(provider ? { provider } : {}),
      userRef: `users/${effectiveDoc.id}`,
    };
    return { event: evt, matched: true, userRef: `users/${effectiveDoc.id}` };
  }

  // Not found: try to create a new user if we have provider+id and repo supports it
  if (!doc && compositeId && typeof (repo as any).ensureUserOnMessage === 'function') {
    try {
      const res = await (repo as any).ensureUserOnMessage(compositeId, { provider, providerUserId: rawId, email, displayName: undefined }, nowIso);
      const createdDoc: AuthUserDoc = res.doc;
      const userOut: any = pick<AuthUserDoc>(createdDoc, ['id', 'email', 'displayName', 'roles', 'status', 'notes']) as any;
      userOut.tags = computeTags(true, true, true, Array.isArray((createdDoc as any).tags) ? (createdDoc as any).tags : undefined);
      (evt as any).user = userOut;
      (evt as any).auth = {
        v: '1',
        method: 'enrichment',
        matched: true,
        at: nowIso,
        ...(provider ? { provider } : {}),
        userRef: `users/${createdDoc.id}`,
      };
      return { event: evt, matched: true, userRef: `users/${createdDoc.id}` };
    } catch {
      // fall through to unmatched
    }
  }

  // Unmatched path
  (evt as any).auth = {
    v: '1',
    method: 'enrichment',
    matched: false,
    at: nowIso,
    ...(provider ? { provider } : {}),
  };
  return { event: evt, matched: false };
}

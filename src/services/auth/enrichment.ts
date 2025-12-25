import { InternalEventV2 } from '../../types/events';
import type { UserRepo, AuthUserDoc } from './user-repo';
import {logger} from "../../common/logging";

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
    anyEvt?.externalEvent?.payload?.userId ||
    anyEvt?.externalEvent?.payload?.broadcasterId ||
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
  created?: boolean;
  isFirstMessage?: boolean;
  isNewSession?: boolean;
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
    logger.debug('auth.user.update', { userRef: `users/${doc.id}` });

    let enrichmentData: any = {};
    if (provider === 'twitch') {
      enrichmentData = mapTwitchEnrichment(evt, nowIso);
    } else if (provider === 'discord') {
      enrichmentData = mapDiscordEnrichment(evt, nowIso);
    }

    // If repo can update counters/session, do it and prefer merged doc
    let created = false;
    let isFirstMessage = false;
    let isNewSession = false;
    let didEnsure = false;
    if (typeof (repo as any).ensureUserOnMessage === 'function' && compositeId) {
      try {
        const res = await (repo as any).ensureUserOnMessage(
          compositeId,
          {
            provider,
            providerUserId: rawId,
            email: doc.email,
            displayName: enrichmentData.displayName || doc.displayName,
            profile: enrichmentData.profile,
            roles: Array.from(new Set([...(doc.roles || []), ...(enrichmentData.roles || [])])),
            rolesMeta: {
              ...(doc.rolesMeta || {}),
              ...(enrichmentData.rolesMeta || {}),
              twitch: Array.from(new Set([...(doc.rolesMeta?.twitch || []), ...(enrichmentData.rolesMeta?.twitch || [])])),
              discord: Array.from(new Set([...(doc.rolesMeta?.discord || []), ...(enrichmentData.rolesMeta?.discord || [])])),
            },
          },
          nowIso
        );
        doc = res.doc;
        created = res.created;
        isFirstMessage = res.isFirstMessage;
        isNewSession = res.isNewSession;
        didEnsure = true;
      } catch (e: any) {
        logger.debug('auth.user.update.failed', { compositeId, error: e?.message || String(e) });
        // non-fatal; proceed with existing doc
      }
    }

    const effectiveDoc = doc as AuthUserDoc;
    const userOut: any = pick<AuthUserDoc>(effectiveDoc, ['id', 'email', 'displayName', 'roles', 'status', 'notes', 'profile', 'rolesMeta']) as any;
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
    return { event: evt, matched: true, userRef: `users/${effectiveDoc.id}`, created, isFirstMessage, isNewSession };
  }

  // Not found: try to create a new user if we have provider+id and repo supports it
  if (!doc && compositeId && typeof (repo as any).ensureUserOnMessage === 'function') {
    logger.debug('auth.user.create', { compositeId });

    let enrichmentData: any = {};
    if (provider === 'twitch') {
      enrichmentData = mapTwitchEnrichment(evt, nowIso);
    } else if (provider === 'discord') {
      enrichmentData = mapDiscordEnrichment(evt, nowIso);
    }

    try {
      const res = await (repo as any).ensureUserOnMessage(
        compositeId,
        {
          provider,
          providerUserId: rawId,
          email,
          displayName: enrichmentData.displayName,
          profile: enrichmentData.profile,
          roles: enrichmentData.roles,
          rolesMeta: enrichmentData.rolesMeta,
        },
        nowIso
      );
      const createdDoc: AuthUserDoc = res.doc;
      const userOut: any = pick<AuthUserDoc>(createdDoc, ['id', 'email', 'displayName', 'roles', 'status', 'notes', 'profile', 'rolesMeta']) as any;
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
      return { event: evt, matched: true, userRef: `users/${createdDoc.id}`, created: true, isFirstMessage: true, isNewSession: true };
    } catch (e: any) {
      logger.debug('auth.user.create.failed', { compositeId, error: e?.message || String(e) });
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

function mapTwitchEnrichment(evt: InternalEventV2, nowIso: string) {
  const messagePayload = (evt as any).message?.rawPlatformPayload || {};
  const externalPayload = (evt as any).externalEvent?.payload || {};
  const roles: string[] = [];
  const twitchRoles: string[] = [];

  if (messagePayload.isMod) {
    roles.push('moderator');
    twitchRoles.push('moderator');
  }
  if (messagePayload.isSubscriber) {
    roles.push('subscriber');
    twitchRoles.push('subscriber');
  }

  const badges = messagePayload.badges || [];
  if (badges.includes('broadcaster')) {
    roles.push('broadcaster');
    twitchRoles.push('broadcaster');
  }
  if (badges.includes('vip')) {
    roles.push('vip');
    twitchRoles.push('vip');
  }

  return {
    displayName: messagePayload.user?.displayName || externalPayload.userDisplayName || externalPayload.broadcasterDisplayName,
    profile: {
      username: messagePayload.user?.login || externalPayload.userLogin || externalPayload.broadcasterLogin || '',
      updatedAt: nowIso,
    },
    roles,
    rolesMeta: {
      twitch: twitchRoles,
    },
  };
}

function mapDiscordEnrichment(evt: InternalEventV2, nowIso: string) {
  const payload = (evt as any).message?.rawPlatformPayload || {};
  const roles: string[] = [];
  const discordRoles: string[] = payload.roles || [];

  // Discord role normalization
  const modRolesEnv = process.env.DISCORD_MOD_ROLES || 'Moderator,Admin,Staff';
  const modRoles = modRolesEnv.split(',').map(r => r.trim().toLowerCase());

  // Check roles IDs or names if available
  // In the current Discord payload, we have role IDs.
  // Ideally we'd have role names too, but if not, we check IDs.
  const hasModRole = discordRoles.some(r => modRoles.includes(r.toLowerCase()));

  // In DiscordIngressClient, we don't currently have guild owner info in meta, but we planned it.
  // Let's check if it's there.
  if (payload.isOwner) {
    roles.push('broadcaster'); // Map server owner to broadcaster role internally
    discordRoles.push('owner');
  }

  if (hasModRole) {
    roles.push('moderator');
  }

  return {
    displayName: payload.authorName,
    profile: {
      username: payload.authorName || '',
      updatedAt: nowIso,
    },
    roles,
    rolesMeta: {
      discord: discordRoles,
    },
  };
}

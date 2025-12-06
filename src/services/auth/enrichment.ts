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

  const id = resolveCandidateId(evt);
  const email = resolveCandidateEmail(evt);

  let doc: AuthUserDoc | null = null;
  if (id) {
    doc = await repo.getById(id);
  }
  if (!doc && email) {
    doc = await repo.getByEmail(email);
  }

  if (doc) {
    (evt as any).user = pick<AuthUserDoc>(doc, ['id', 'email', 'displayName', 'roles', 'status']) as any;
    (evt as any).auth = {
      v: '1',
      method: 'enrichment',
      matched: true,
      at: nowIso,
      ...(provider ? { provider } : {}),
      userRef: `users/${doc.id}`,
    };
    return { event: evt, matched: true, userRef: `users/${doc.id}` };
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

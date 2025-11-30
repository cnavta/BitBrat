import { InternalEventV1 } from '../../types/events';
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

function resolveCandidateId(evt: InternalEventV1): string | undefined {
  return (
    evt?.envelope?.user?.id ||
    (typeof (evt as any).userId === 'string' ? (evt as any).userId : undefined) ||
    (typeof (evt?.payload as any)?.userId === 'string' ? (evt?.payload as any)?.userId : undefined)
  );
}

function resolveCandidateEmail(evt: InternalEventV1): string | undefined {
  const fromEnvelope = (evt?.envelope as any)?.user?.email;
  if (typeof fromEnvelope === 'string' && fromEnvelope) return fromEnvelope;
  const fromPayload = (evt?.payload as any)?.email;
  if (typeof fromPayload === 'string' && fromPayload) return fromPayload;
  return undefined;
}

export interface EnrichResult {
  event: InternalEventV1;
  matched: boolean;
  userRef?: string;
}

/** Pure enrichment function: queries repo and returns updated event copy with envelope.user/auth set. */
export async function enrichEvent(
  event: InternalEventV1,
  repo: UserRepo,
  opts: EnrichOptions = {}
): Promise<EnrichResult> {
  const nowIso = opts.now ? opts.now() : new Date().toISOString();
  const provider = opts.provider;

  // Shallow copy event and envelope to avoid mutating caller references
  const evt: InternalEventV1 = {
    ...event,
    envelope: { ...(event.envelope || { v: '1', source: '', correlationId: '' }) },
  };

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
    evt.envelope.user = pick<AuthUserDoc>(doc, ['id', 'email', 'displayName', 'roles', 'status']) as any;
    evt.envelope.auth = {
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
  evt.envelope.auth = {
    v: '1',
    method: 'enrichment',
    matched: false,
    at: nowIso,
    ...(provider ? { provider } : {}),
  };
  return { event: evt, matched: false };
}

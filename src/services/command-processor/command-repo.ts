import { Firestore, DocumentReference } from 'firebase-admin/firestore';
import { getFirestore } from '../../common/firebase';
import { getConfig } from '../../common/config';
import { logger } from '../../common/logging';
import {AnnotationKindV1} from "@/types";

export interface CommandTemplate {
  id: string;
  text: string;
}

export interface CommandDoc {
  id: string;
  name: string;
  type?: 'candidate' | 'annotation';
  annotationKind?: AnnotationKindV1;
  matchType: {
    kind: 'command' | 'regex',
    values: string[];
    priority: number;
  },
  description?: string;
  templates: CommandTemplate[];
  cooldowns?: { globalMs?: number; perUserMs?: number };
  rateLimit?: { max: number; perMs: number };
  runtime?: { lastUsedTemplateId?: string; lastExecutionAt?: string };
}

export interface CommandLookupResult {
  ref: DocumentReference;
  doc: CommandDoc;
}

export function getCollectionPath(): string {
  const cfg = getConfig();
  return cfg.commandsCollection || 'commands';
}

/** Internal: normalize Firestore data into CommandDoc (vNext shape). */
function normalizeCommand(id: string, data: any): CommandDoc | null {
  if (!data) return null;
  const templates = Array.isArray(data.templates)
    ? data.templates
        .map((t: any) => ({ id: String(t.id || ''), text: String(t.text || '') }))
        .filter((t: CommandTemplate) => t.id && t.text)
    : [];
  const rateMax = data?.rateLimit != null ? toInt(data.rateLimit.max) ?? 0 : undefined;
  const ratePer = data?.rateLimit != null ? toInt(data.rateLimit.perMs) ?? 60000 : undefined;
  return {
    id,
    name: String(data.name || '').toLowerCase(),
    description: data.description ? String(data.description) : undefined,
    annotationKind: data.annotationKind as AnnotationKindV1,
    type: data.type || 'candidate',
    matchType: data.matchType
      ? {
          kind: (data.matchType.kind === 'regex' ? 'regex' : 'command') as 'command' | 'regex',
          values: Array.isArray(data.matchType.values)
            ? data.matchType.values.map((v: any) => String(v))
            : [],
          priority: toInt(data.matchType.priority) ?? 0,
        }
      : { kind: 'command', values: [String(data.name || '').toLowerCase()].filter(Boolean), priority: 0 },
    templates,
    cooldowns: data.cooldowns ? { globalMs: toInt(data.cooldowns.globalMs), perUserMs: toInt(data.cooldowns.perUserMs) } : undefined,
    rateLimit: data.rateLimit ? { max: rateMax as number, perMs: ratePer as number } : undefined,
    runtime: data.runtime
      ? {
          lastUsedTemplateId: data.runtime.lastUsedTemplateId ? String(data.runtime.lastUsedTemplateId) : undefined,
          lastExecutionAt: data.runtime.lastExecutionAt ? String(data.runtime.lastExecutionAt) : undefined,
        }
      : undefined,
  };
}

function toInt(v: any): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

/**
 * Find a command by canonical name or alias (case-insensitive; expects inputs are lowercased).
 * Performs up to two indexed queries: first on name, then on aliases (array-contains).
 */
export async function findByNameOrAlias(name: string, db?: Firestore): Promise<CommandLookupResult | null> {
  const lc = String(name || '').toLowerCase();
  if (!lc) return null;
  logger.debug('command_repo.lookup.start', { name: lc });
  const database = db || getFirestore();
  const col = database.collection(getCollectionPath());
  try {
    // Legacy lookup: prefer explicit name match; kept for backward compatibility
    const byNameSnap = await col.where('name', '==', lc).limit(1).get();
    if (!byNameSnap.empty) {
      const d = byNameSnap.docs[0];
      const doc = normalizeCommand(d.id, d.data());
      logger.debug('command_repo.lookup.found', { name: lc, by: 'name' });
      if (doc) return { ref: d.ref, doc };
    }
    // Legacy alias fallback for existing tests
    const byAliasSnap = await col.where('aliases', 'array-contains', lc).limit(1).get();
    if (!byAliasSnap.empty) {
      const d = byAliasSnap.docs[0];
      const doc = normalizeCommand(d.id, d.data());
      logger.debug('command_repo.lookup.found', { name: lc, by: 'alias' });
      if (doc) return { ref: d.ref, doc };
    }
    return null;
  } catch (e: any) {
    logger.error('command_repo.lookup.error', { name: lc, error: e?.message || String(e) });
    throw e;
  }
}

/**
 * vNext: Find first command by term using matchType (kind='command', values array-contains term) ordered by priority ASC.
 */
export async function findFirstByCommandTerm(term: string, db?: Firestore): Promise<CommandLookupResult | null> {
  const lc = String(term || '').toLowerCase();
  if (!lc) return null;
  const database = db || getFirestore();
  const col = database.collection(getCollectionPath());
  try {
    const snap = await col
      .where('matchType.kind', '==', 'command')
      .where('matchType.values', 'array-contains', lc)
      .orderBy('matchType.priority', 'asc')
      .limit(1)
      .get();
    if (snap.empty) return null;
    const d = snap.docs[0];
    const doc = normalizeCommand(d.id, d.data());
    logger.debug('command_repo.findFirstByCommandTerm.found', { term: lc, docId: doc?.id });
    return doc ? { ref: d.ref, doc } : null;
  } catch (e: any) {
    logger.error('command_repo.findFirstByCommandTerm.error', { term: lc, error: e?.message || String(e) });
    throw e;
  }
}

/** Helper: reference to per-user cooldown doc under a command document. */
export function userCooldownRef(commandRef: DocumentReference, userId: string): DocumentReference {
  return commandRef.collection('cooldowns').doc('users').collection('byId').doc(String(userId));
}

/** Helper: reference to a fixed-window rate bucket under a command document. */
export function rateWindowRef(commandRef: DocumentReference, windowKey: string): DocumentReference {
  return commandRef.collection('rate-limits').doc('windows').collection('byKey').doc(String(windowKey));
}

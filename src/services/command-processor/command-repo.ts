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
  description?: string;
  aliases?: string[];
  templates: CommandTemplate[];
  cooldowns?: { globalMs?: number; perUserMs?: number };
  rateLimit?: { max: number; perMs: number };
  runtime?: { lastUsedTemplateId?: string; lastExecutionAt?: string };
}

export interface CommandLookupResult {
  ref: DocumentReference;
  doc: CommandDoc;
}

function getCollectionPath(): string {
  const cfg = getConfig();
  return cfg.commandsCollection || 'commands';
}

/** Internal: normalize Firestore data into CommandDoc. */
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
    aliases: Array.isArray(data.aliases) ? data.aliases.map((a: any) => String(a).toLowerCase()) : undefined,
    annotationKind: data.annotationKind as AnnotationKindV1,
    type: data.type || 'candidate',
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
  const database = db || getFirestore();
  const col = database.collection(getCollectionPath());
  try {
    // Primary lookup by canonical name
    const byNameSnap = await col.where('name', '==', lc).limit(1).get();
    if (!byNameSnap.empty) {
      const d = byNameSnap.docs[0];
      const doc = normalizeCommand(d.id, d.data());
      if (doc) return { ref: d.ref, doc };
    }
    // Fallback lookup by alias
    const byAliasSnap = await col.where('aliases', 'array-contains', lc).limit(1).get();
    if (!byAliasSnap.empty) {
      const d = byAliasSnap.docs[0];
      const doc = normalizeCommand(d.id, d.data());
      if (doc) return { ref: d.ref, doc };
    }
    return null;
  } catch (e: any) {
    logger.error('command_repo.lookup.error', { name: lc, error: e?.message || String(e) });
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

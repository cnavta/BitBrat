import type { Firestore, DocumentData } from 'firebase-admin/firestore';
import { getFirestore } from '../../common/firebase';
import type { InternalEventV2, AnnotationV1 } from '../../types/events';
import { metrics } from '../../common/metrics';

type RoleDoc = {
  roleId?: string;
  displayName?: string;
  enabled?: boolean;
  priority?: number;
  prompt?: string;
  aliases?: string[];
};

type RolesMap = Map<string, { id: string; display: string; priority: number; prompt?: string }>;

type CacheEntry<T> = { value: T; expiresAt: number };

const rolesCache: Map<string, CacheEntry<RolesMap>> = new Map();
const userCache: Map<string, CacheEntry<any>> = new Map();

function now() { return Date.now(); }

function parsePath(db: Firestore, path: string) {
  // Supports "/collection/doc/collection" pattern, e.g., /configs/bot/roles
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 3 || parts.length % 2 === 0) {
    throw new Error(`invalid_roles_path:${path}`);
  }
  let ref: any = db.collection(parts[0]);
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    if (i % 2 === 1) {
      ref = ref.doc(seg);
    } else {
      ref = ref.collection(seg);
    }
  }
  return ref;
}

export interface UserContextConfig {
  rolesPath: string; // e.g., "/configs/bot/roles"
  ttlMs: number; // cache ttl for roles and user
  includeDescription: boolean;
  maxChars: number; // overall clamp budget for the composed context
  injectionMode: 'append' | 'prefix' | 'annotation';
}

export interface ComposedUserContext {
  username?: string;
  roles?: string[];
  rolePrompts?: string[];
  description?: string;
  degraded?: boolean;
  text?: string; // final composed text value
}

export async function loadEnabledRoles(cfg: UserContextConfig, db?: Firestore): Promise<RolesMap> {
  const key = cfg.rolesPath;
  const cached = rolesCache.get(key);
  if (cached && cached.expiresAt > now()) return cached.value;
  const database = db || getFirestore();
  try {
    const colRef = parsePath(database, cfg.rolesPath);
    const snap = await colRef.where('enabled', '==', true).get();
    const map: RolesMap = new Map();
    for (const doc of snap.docs) {
      const d = doc.data() as RoleDoc;
      const id = (doc.id || d.roleId || '').toLowerCase();
      if (!id) continue;
      map.set(id, {
        id,
        display: d.displayName || id,
        priority: typeof d.priority === 'number' ? d.priority : 100,
        prompt: d.prompt || undefined,
      });
      const aliases = Array.isArray(d.aliases) ? d.aliases : [];
      for (const a of aliases) {
        const aid = String(a || '').toLowerCase();
        if (!aid) continue;
        if (!map.has(aid)) map.set(aid, map.get(id)!);
      }
    }
    rolesCache.set(key, { value: map, expiresAt: now() + Math.max(0, cfg.ttlMs || 0) });
    return map;
  } catch (e) {
    return new Map();
  }
}

export async function loadUserDoc(userId: string, cfg: UserContextConfig, db?: Firestore): Promise<any | null> {
  try {
    if (!userId) return null;
    const c = userCache.get(userId);
    if (c && c.expiresAt > now()) return c.value;
    const database = db || getFirestore();
    const snap = await (database as any).collection('users').doc(userId).get();
    if (!snap || !snap.exists) return null;
    const data = snap.data() as DocumentData;
    userCache.set(userId, { value: data, expiresAt: now() + Math.max(0, cfg.ttlMs || 0) });
    return data;
  } catch {
    return null;
  }
}

export function composeContextText(input: {
  username?: string;
  rolesDisplay?: string[];
  rolePrompts?: string[];
  description?: string;
}, maxChars: number): string {
  const lines: string[] = [];
  if (input.username) lines.push(`Username: ${input.username}`);
  if (input.rolesDisplay && input.rolesDisplay.length > 0) lines.push(`Roles: ${input.rolesDisplay.join(', ')}`);
  if (input.rolePrompts && input.rolePrompts.length > 0) lines.push(...input.rolePrompts);
  if (input.description) lines.push(`Description: ${input.description}`);
  let text = lines.join('\n');
  if (isFinite(maxChars) && maxChars > 0 && text.length > maxChars) {
    // Truncate with least important first: description, then role prompts (reverse order), then roles list
    const parts = {
      username: input.username ? `Username: ${input.username}` : undefined,
      roles: input.rolesDisplay && input.rolesDisplay.length > 0 ? `Roles: ${input.rolesDisplay.join(', ')}` : undefined,
      rolePrompts: (input.rolePrompts || []).slice(),
      description: input.description ? `Description: ${input.description}` : undefined,
    };
    // Remove description
    const build = () => {
      const l: string[] = [];
      if (parts.username) l.push(parts.username);
      if (parts.roles) l.push(parts.roles);
      if (parts.rolePrompts && parts.rolePrompts.length > 0) l.push(...parts.rolePrompts);
      if (parts.description) l.push(parts.description);
      return l.join('\n');
    };
    if (parts.description) {
      parts.description = undefined;
      text = build();
    }
    while (text.length > maxChars && parts.rolePrompts && parts.rolePrompts.length > 0) {
      parts.rolePrompts.pop();
      text = build();
    }
    if (text.length > maxChars && parts.roles) {
      parts.roles = undefined;
      text = build();
    }
  }
  return text;
}

export async function buildUserContextAnnotation(evt: InternalEventV2, cfg: UserContextConfig, db?: Firestore): Promise<AnnotationV1 | undefined> {
  if (!cfg) return undefined;
  const descriptionEnabled = cfg.includeDescription;
  try {
    const rolesMap = await loadEnabledRoles(cfg, db);
    const userId = evt.user?.id || evt.userId;
    let username = evt.user?.displayName || evt.message?.rawPlatformPayload?.username || evt.message?.rawPlatformPayload?.user || undefined;
    let roles: string[] | undefined;
    let description: string | undefined;

    const userDoc = userId ? await loadUserDoc(userId, cfg, db) : null;
    if (userDoc) {
      const profile = userDoc.profile || {};
      if (!username && profile.username) username = String(profile.username);
      if (Array.isArray(userDoc.roles)) roles = userDoc.roles.map((r: any) => String(r || '').toLowerCase()).filter(Boolean);
      if (descriptionEnabled && profile.description) description = String(profile.description);
    }
    if (!roles || roles.length === 0) {
      // fallback to evt.user.roles if present
      const rs = Array.isArray(evt.user?.roles) ? evt.user!.roles! : [];
      roles = rs.map((r) => String(r || '').toLowerCase()).filter(Boolean);
    }

    const roleObjs: { id: string; display: string; priority: number; prompt?: string }[] = [];
    for (const r of roles || []) {
      const hit = rolesMap.get(String(r).toLowerCase());
      if (hit) roleObjs.push(hit);
    }
    roleObjs.sort((a, b) => (a.priority - b.priority));
    const rolesDisplay = roleObjs.map((r) => r.display);
    const rolePrompts = roleObjs.map((r) => r.prompt).filter((p): p is string => !!p);

    const text = composeContextText({ username, rolesDisplay, rolePrompts, description }, cfg.maxChars);

    const isPrompt = cfg.injectionMode === 'append';
    const ann: AnnotationV1 = {
      id: 'ctx-' + (evt.correlationId || Date.now().toString(36)),
      kind: isPrompt ? 'prompt' : 'personality',
      source: 'llm-bot.user-context',
      createdAt: new Date().toISOString(),
      label: 'user-context-v1',
      payload: {
        username,
        roles: (roles || []).slice(),
        rolePrompts,
        description,
        mode: cfg.injectionMode,
        text: text,
      },
      value: isPrompt ? text : undefined,
    };
    return ann;
  } catch {
    // degraded
    const username = evt.user?.displayName || evt.message?.rawPlatformPayload?.username || undefined;
    const text = composeContextText({ username }, cfg.maxChars);
    const isPrompt = cfg.injectionMode === 'append';
    const ann: AnnotationV1 = {
      id: 'ctx-' + (evt.correlationId || Date.now().toString(36)),
      kind: isPrompt ? 'prompt' : 'personality',
      source: 'llm-bot.user-context',
      createdAt: new Date().toISOString(),
      label: 'user-context-v1',
      payload: { username, degraded: true, mode: cfg.injectionMode, text },
      value: isPrompt ? text : undefined,
    };
    return ann;
  }
}

export function __resetCachesForTests() {
  rolesCache.clear();
  userCache.clear();
}

import type { AnnotationV1 } from '../../types/events';

export type ComposeMode = 'append' | 'prepend' | 'replace';

export interface PersonalityDoc {
  name: string;
  text: string;
  status: 'active' | 'inactive' | 'archived' | string;
  version?: number;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ResolverDeps {
  // Injected lookup for tests and production. Should return latest active doc text for given name.
  fetchByName?: (name: string) => Promise<PersonalityDoc | undefined>;
  logger?: { debug?: Function; info?: Function; warn?: Function; error?: Function };
}

export interface ResolveOptions {
  maxAnnotations: number;
  maxChars: number;
  cacheTtlMs: number;
}

export interface ResolvedPersonality {
  name?: string;
  text: string;
  source: 'inline' | 'firestore' | 'unknown';
  version?: number;
}

type CacheEntry = { text: string; version?: number; expiresAt: number };

const cache = new Map<string, CacheEntry>();

function sanitize(text: string): string {
  // Minimal sanitation; real implementation could add stricter policies.
  const t = String(text || '').replace(/\u0000/g, '').trim();
  return t;
}

function clamp(text: string, maxChars: number): string {
  if (!isFinite(maxChars) || maxChars <= 0) return text;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

function sortByCreatedAtAsc(a: AnnotationV1, b: AnnotationV1): number {
  const at = Date.parse(a.createdAt || '') || 0;
  const bt = Date.parse(b.createdAt || '') || 0;
  if (at !== bt) return at - bt;
  return (a.id || '').localeCompare(b.id || '');
}

export async function resolvePersonalityParts(
  annotations: AnnotationV1[] | undefined,
  opts: ResolveOptions,
  deps: ResolverDeps = {}
): Promise<ResolvedPersonality[]> {
  const anns = Array.isArray(annotations) ? annotations : [];
  const personalityAnns = anns.filter((a) => a?.kind === 'personality' && a?.payload && (a.payload.text || a.payload.name));
  if (personalityAnns.length === 0) return [];

  const { maxAnnotations, maxChars, cacheTtlMs } = opts;
  const selected = personalityAnns
    .slice() // do not mutate source
    .sort(sortByCreatedAtAsc)
    .slice(0, Math.max(0, maxAnnotations || 0));

  const results: ResolvedPersonality[] = [];
  for (const ann of selected) {
    const inline = (ann.payload as any)?.text as string | undefined;
    const name = (ann.payload as any)?.name as string | undefined;
    if (inline && inline.trim()) {
      const text = clamp(sanitize(inline), maxChars);
      results.push({ name, text, source: 'inline' });
      continue;
    }
    if (!name) continue;

    const now = Date.now();
    const cached = cache.get(name);
    if (cached && cached.expiresAt > now) {
      results.push({ name, text: clamp(cached.text, maxChars), source: 'firestore', version: cached.version });
      continue;
    }

    try {
      if (typeof deps.fetchByName !== 'function') {
        deps.logger?.warn?.('personality.resolve.skip_no_driver', { name });
        continue;
      }
      const doc = await deps.fetchByName(name);
      if (!doc) {
        deps.logger?.info?.('personality.resolve.miss', { name });
        continue;
      }
      if (doc.status !== 'active') {
        deps.logger?.info?.('personality.resolve.inactive', { name, status: doc.status });
        continue;
      }
      const clean = sanitize(doc.text || '');
      const text = clamp(clean, maxChars);
      results.push({ name: doc.name, text, source: 'firestore', version: doc.version });
      cache.set(name, { text: clean, version: doc.version, expiresAt: now + Math.max(0, cacheTtlMs || 0) });
    } catch (e: any) {
      deps.logger?.warn?.('personality.resolve.error', { name, error: e?.message || String(e) });
      continue;
    }
  }

  return results;
}

export function composeSystemPrompt(
  baseSystem: string | undefined,
  parts: ResolvedPersonality[],
  mode: ComposeMode
): string | undefined {
  const cleanedBase = (baseSystem || '').trim();
  const personalities = parts.map((p) => p.text).filter(Boolean);
  if (personalities.length === 0) return cleanedBase || undefined;

  const sep = '\n\n';
  switch (mode) {
    case 'prepend':
      return [personalities.join(sep), cleanedBase].filter(Boolean).join(sep).trim() || undefined;
    case 'replace':
      // Keep a minimal safety header to avoid an empty system prompt.
      return personalities.join(sep).trim() || 'You are BitBrat LLM bot. Follow safety and platform rules.';
    case 'append':
    default:
      return [cleanedBase, personalities.join(sep)].filter(Boolean).join(sep).trim() || undefined;
  }
}

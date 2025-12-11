import { Firestore, Query, QuerySnapshot } from 'firebase-admin/firestore';
import { getFirestore } from '../../common/firebase';
import { getConfig } from '../../common/config';
import { logger } from '../../common/logging';
import { CommandDoc, getCollectionPath } from './command-repo';

type CompiledRegexEntry = { ref: any; doc: CommandDoc; patterns: RegExp[] };

let compiledCache: CompiledRegexEntry[] = [];
let unsubscribeFn: (() => void) | null = null;
let started = false;

function safeCompile(pattern: string): RegExp | null {
  try {
    // Always use case-insensitive by default; authors can embed flags via (?i) if needed, but for safety we force 'i'
    return new RegExp(pattern, 'i');
  } catch (e: any) {
    logger.warn('regex_cache.compile.error', { patternPreview: String(pattern).slice(0, 80), error: e?.message || String(e) });
    return null;
  }
}

function rebuildFromSnapshot(snap: QuerySnapshot): void {
  const cfg = getConfig();
  const maxCommands = Number(cfg.regexMaxCommands ?? Number.POSITIVE_INFINITY);
  const maxPatternsPer = Number(cfg.regexMaxPatternsPerCommand ?? Number.POSITIVE_INFINITY);
  const items: CompiledRegexEntry[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    const doc: CommandDoc | null = ((): any => {
      // Lazy import to avoid cycles
      const { default: noop } = { default: null } as any;
      // command-repo exports a normalize function internally only; re-normalize minimally here
      const mt = data?.matchType || {};
      const values = Array.isArray(mt.values) ? mt.values.map((v: any) => String(v)) : [];
      const entry: CommandDoc = {
        id: d.id,
        name: String(data.name || '').toLowerCase(),
        description: data.description ? String(data.description) : undefined,
        annotationKind: data.annotationKind,
        type: data.type || 'candidate',
        matchType: { kind: 'regex', values, priority: Number(mt.priority || 0) | 0 },
        templates: Array.isArray(data.templates)
          ? data.templates
              .map((t: any) => ({ id: String(t.id || ''), text: String(t.text || '') }))
              .filter((t: any) => t.id && t.text)
          : [],
        cooldowns: data.cooldowns,
        rateLimit: data.rateLimit,
        runtime: data.runtime,
      } as CommandDoc;
      return entry;
    })();
    if (!doc) continue;
    const patterns: RegExp[] = [];
    let taken = 0;
    for (const p of doc.matchType.values) {
      if (taken >= maxPatternsPer) break;
      const rx = safeCompile(p);
      if (rx) {
        patterns.push(rx);
        taken++;
      }
    }
    // Skip entries with no valid patterns
    if (!patterns.length) continue;
    items.push({ ref: d.ref, doc, patterns });
  }
  // Sort by priority ASC then id for stability
  items.sort((a, b) => {
    const pa = a.doc.matchType?.priority ?? 0;
    const pb = b.doc.matchType?.priority ?? 0;
    if (pa !== pb) return pa - pb;
    return String(a.doc.id).localeCompare(String(b.doc.id));
  });
  const limited = Number.isFinite(maxCommands) ? items.slice(0, Math.max(0, maxCommands)) : items;
  compiledCache = limited;
  logger.info('regex_cache.rebuilt', {
    count: compiledCache.length,
    totalDocs: items.length,
    appliedCaps: {
      maxCommands: Number.isFinite(maxCommands) ? maxCommands : undefined,
      maxPatternsPerCommand: Number.isFinite(maxPatternsPer) ? maxPatternsPer : undefined,
    },
  });
}

export function getCompiledRegexCommands(): ReadonlyArray<CompiledRegexEntry> {
  return compiledCache;
}

export function startRegexCache(db?: Firestore): () => void {
  if (started) return () => stopRegexCache();
  started = true;
  const database = db || getFirestore();
  const col = database.collection(getCollectionPath());
  const q: Query = col.where('matchType.kind', '==', 'regex').orderBy('matchType.priority', 'asc');
  logger.info('regex_cache.start', {});
  unsubscribeFn = q.onSnapshot(
    (snap) => {
      try {
        rebuildFromSnapshot(snap);
      } catch (e: any) {
        logger.error('regex_cache.rebuild.error', { error: e?.message || String(e) });
      }
    },
    (err) => {
      logger.error('regex_cache.snapshot.error', { error: err?.message || String(err) });
    }
  );
  return () => stopRegexCache();
}

export function stopRegexCache(): void {
  if (unsubscribeFn) {
    try {
      unsubscribeFn();
    } catch (e) {
      // ignore
    }
    unsubscribeFn = null;
  }
  started = false;
}

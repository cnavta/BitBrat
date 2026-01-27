/**
 * RuleLoader – Firestore-backed routing rules cache
 *
 * - Warm-loads rules from Firestore collection (default: configs/routingRules/rules)
 * - Validates minimal schema
 * - Maintains in-memory cache of enabled, valid rules sorted by priority asc (tie: id asc)
 * - Subscribes via onSnapshot to keep cache up to date
 */
import { logger } from '../../common/logging';
import {AnnotationV1, CandidateV1} from '../../types/events';

export interface RoutingStepRef {
  id: string;
  v?: string;
  nextTopic: string;
  maxAttempts?: number;
  attributes?: Record<string, string>;
}

export interface RuleDoc {
  id: string; // Firestore document id
  enabled: boolean;
  priority: number;
  description?: string;
  // Firestore stores JsonLogic as a JSON string (see sprint-127 change)
  logic: string;
  routingSlip: RoutingStepRef[];
  enrichments: { // Enrichments to perform on the event when matched.
    message?: string; // Message text to add to the event when matched.
    annotations?: AnnotationV1[];// Annotations to add to the event when matched.
    candidates?: CandidateV1[]; // Candidates to add to the event when matched.
    randomCandidate?: boolean; // Add a single, random candidate that was not previously used from the candidates set instead of all of them.
  }
  metadata?: Record<string, unknown>;
}

type Unsubscribe = () => void;

function isObject(v: any): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isAnnotation(v: any): v is AnnotationV1 {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof v.id === 'string' &&
    typeof v.kind === 'string' &&
    typeof v.source === 'string' &&
    typeof v.createdAt === 'string'
  );
}

function isCandidate(v: any): v is CandidateV1 {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof v.id === 'string' &&
    typeof v.kind === 'string' &&
    typeof v.source === 'string' &&
    typeof v.createdAt === 'string' &&
    typeof v.status === 'string' &&
    typeof v.priority === 'number'
  );
}

function sanitizeAnnotations(rawAnns: any, id: string): AnnotationV1[] | undefined {
  if (!Array.isArray(rawAnns)) return undefined;
  const out: AnnotationV1[] = [];
  for (const a of rawAnns) {
    if (isAnnotation(a)) {
      // Shallow clone to avoid accidental mutation downstream
      const clean: AnnotationV1 = {
        id: String(a.id),
        kind: String(a.kind),
        source: String(a.source),
        createdAt: String(a.createdAt),
        confidence: typeof a.confidence === 'number' ? a.confidence : undefined,
        label: typeof a.label === 'string' ? a.label : undefined,
        value: typeof a.value === 'string' ? a.value : undefined,
        score: typeof a.score === 'number' ? a.score : undefined,
        payload: isObject(a.payload) ? (a.payload as Record<string, any>) : undefined,
      };
      out.push(clean);
    } else if (a) {
      logger.warn('rule_loader.annotation_invalid', { ruleId: id });
    }
  }
  return out.length ? out : undefined;
}

function sanitizeCandidates(rawCandidates: any, id: string): CandidateV1[] | undefined {
  if (!Array.isArray(rawCandidates)) return undefined;
  const out: CandidateV1[] = [];
  for (const c of rawCandidates) {
    if (isCandidate(c)) {
      // Shallow clone
      const clean: CandidateV1 = {
        id: String(c.id),
        kind: String(c.kind),
        source: String(c.source),
        createdAt: String(c.createdAt),
        status: c.status as any,
        priority: Number(c.priority),
        confidence: typeof c.confidence === 'number' ? c.confidence : undefined,
        text: typeof c.text === 'string' ? c.text : undefined,
        format: typeof c.format === 'string' ? c.format : undefined,
        reason: typeof c.reason === 'string' ? c.reason : undefined,
        metadata: isObject(c.metadata) ? (c.metadata as Record<string, any>) : undefined,
      };
      out.push(clean);
    } else if (c) {
      logger.warn('rule_loader.candidate_invalid', { ruleId: id });
    }
  }
  return out.length ? out : undefined;
}

function validateRule(raw: any, id: string): RuleDoc | null {
  if (!isObject(raw)) return null;
  if (raw.enabled !== true) return null; // only cache enabled
  const priority = raw.priority;
  if (typeof priority !== 'number' || Number.isNaN(priority)) return null;
  // Expect logic to be a JSON string; allow object for backward-compat by stringifying
  let logicStr: string | null = null;
  if (typeof raw.logic === 'string') {
    const s = raw.logic.trim();
    if (!s) return null;
    logicStr = s;
  } else if (isObject(raw.logic)) {
    try {
      logicStr = JSON.stringify(raw.logic);
    } catch {
      return null;
    }
  } else {
    return null;
  }
  if (!Array.isArray(raw.routingSlip)) return null;
  const routingSlip = raw.routingSlip.filter((s: any) => isObject(s) && typeof s.nextTopic === 'string');
  if (routingSlip.length === 0) return null;

  // Handle enrichments
  const rawEnrich = isObject(raw.enrichments) ? raw.enrichments : {};
  const enrichments: RuleDoc['enrichments'] = {
    message: typeof rawEnrich.message === 'string' ? rawEnrich.message : undefined,
    annotations: sanitizeAnnotations(rawEnrich.annotations || raw.annotations, id),
    candidates: sanitizeCandidates(rawEnrich.candidates, id),
    randomCandidate: !!rawEnrich.randomCandidate,
  };

  return {
    id,
    enabled: true,
    priority,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    logic: logicStr as string,
    routingSlip: routingSlip as RoutingStepRef[],
    enrichments,
    metadata: isObject(raw.metadata) ? (raw.metadata as Record<string, unknown>) : undefined,
  };
}

function sortRules(rules: RuleDoc[]): RuleDoc[] {
  return [...rules].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority; // ascending
    return a.id.localeCompare(b.id);
  });
}

export class RuleLoader {
  private cache: RuleDoc[] = [];
  private unsub: Unsubscribe | null = null;
  constructor(private readonly collectionPath = 'configs/routingRules/rules') {}

  /** Read-only snapshot of current cache */
  getRules(): ReadonlyArray<RuleDoc> {
    return this.cache;
  }

  /** Stop listening for updates */
  stop() {
    if (this.unsub) {
      try { this.unsub(); } catch {}
      this.unsub = null;
    }
  }

  /**
   * Start warm-loading and subscribing to Firestore updates.
   * Accepts a Firestore-like db with collection(path).get() and .onSnapshot(cb).
   */
  async start(db: any) {
    const normalize = (p: string | undefined): string => {
      const base = String(p || '').trim().replace(/^\/+|\/+$/g, '');
      if (!base) return 'routingRules';
      const parts = base.split('/').filter(Boolean);
      // Firestore collection paths must have an odd number of segments (1,3,5,...)
      if (parts.length % 2 === 0) {
        const to = [...parts, 'rules'].join('/');
        logger.warn('rule_loader.collection_path_normalized', { from: base, to });
        return to;
      }
      return parts.join('/');
    };

    const path = normalize(this.collectionPath);
    const col = db.collection(path);
    // Warm load
    try {
      const snap = await col.get();
      this.refreshFromSnapshot(snap);
      logger.debug('rule_loader.warm_loaded', { count: this.cache.length });
    } catch (e: any) {
      logger.error('rule_loader.warm_load_error', { error: e?.message || String(e) });
      // Continue; cache remains empty
    }
    // Subscribe
    try {
      this.unsub = col.onSnapshot((snap: any) => {
        try {
          this.refreshFromSnapshot(snap);
          logger.debug('rule_loader.snapshot_applied', { count: this.cache.length });
        } catch (e: any) {
          logger.error('rule_loader.snapshot_error', { error: e?.message || String(e) });
        }
      });
    } catch (e: any) {
      logger.error('rule_loader.subscribe_error', { error: e?.message || String(e) });
    }
  }

  private refreshFromSnapshot(snap: any) {
    const next: RuleDoc[] = [];
    const docs: any[] = Array.isArray(snap?.docs) ? snap.docs : [];
    for (const d of docs) {
      const id = String(d?.id || '');
      const data = typeof d?.data === 'function' ? d.data() : undefined;
      const rule = validateRule(data, id);
      if (rule) next.push(rule);
      else if (data && data.enabled !== false) {
        logger.warn('rule_loader.invalid_doc', { id });
      }
    }
    this.cache = sortRules(next);
  }
}

export default RuleLoader;

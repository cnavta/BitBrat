/**
 * RuleLoader – Firestore-backed routing rules cache
 *
 * - Warm-loads rules from Firestore collection (default: configs/routingRules/rules)
 * - Validates minimal schema
 * - Maintains in-memory cache of enabled, valid rules sorted by priority asc (tie: id asc)
 * - Subscribes via onSnapshot to keep cache up to date
 */
import { logger } from '../../common/logging';

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
  logic: Record<string, unknown>;
  routingSlip: RoutingStepRef[];
  metadata?: Record<string, unknown>;
}

type Unsubscribe = () => void;

function isObject(v: any): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function validateRule(raw: any, id: string): RuleDoc | null {
  if (!isObject(raw)) return null;
  if (raw.enabled !== true) return null; // only cache enabled
  const priority = raw.priority;
  if (typeof priority !== 'number' || Number.isNaN(priority)) return null;
  if (!isObject(raw.logic)) return null;
  if (!Array.isArray(raw.routingSlip)) return null;
  const routingSlip = raw.routingSlip.filter((s: any) => isObject(s) && typeof s.nextTopic === 'string');
  if (routingSlip.length === 0) return null;
  return {
    id,
    enabled: true,
    priority,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    logic: raw.logic as Record<string, unknown>,
    routingSlip: routingSlip as RoutingStepRef[],
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

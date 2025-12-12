/**
 * Minimal in-process metrics emitter for counters.
 * - No external export; intended for unit tests and local observability.
 * - Counters are keyed by name (string). Optional labels can be folded into the name if needed later.
 */

type CounterStore = Map<string, number>;

class MetricsEmitter {
  private counters: CounterStore = new Map();

  inc(name: string, value = 1) {
    if (!name) return;
    const cur = this.counters.get(name) || 0;
    this.counters.set(name, cur + (isFinite(value) ? value : 1));
  }

  get(name: string): number {
    return this.counters.get(name) || 0;
  }

  resetAll() {
    this.counters.clear();
  }

  /** For debugging/tests only */
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.counters.entries()) out[k] = v;
    return out;
  }
}

export const metrics = new MetricsEmitter();

// Common metric names used by llm-bot personality pipeline
export const METRIC_PERSONALITIES_RESOLVED = 'personalities_resolved_total';
export const METRIC_PERSONALITIES_FAILED = 'personalities_failed_total';
export const METRIC_PERSONALITIES_DROPPED = 'personalities_dropped_total';
export const METRIC_PERSONALITY_CACHE_HIT = 'personality_cache_hit_total';
export const METRIC_PERSONALITY_CACHE_MISS = 'personality_cache_miss_total';
export const METRIC_PERSONALITY_CLAMPED = 'personality_clamped_total';

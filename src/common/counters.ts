/**
 * In-memory counters for observability. Non-persistent, process-local.
 * Exposed via /_debug/counters on services that choose to publish them.
 */
export type CounterKey =
  | 'router.events.total'
  | 'router.rules.matched'
  | 'router.rules.defaulted';

type Snapshot = Record<CounterKey, number>;

class Counters {
  private values: Snapshot = {
    'router.events.total': 0,
    'router.rules.matched': 0,
    'router.rules.defaulted': 0,
  };

  increment(key: CounterKey, by = 1) {
    const amt = Number.isFinite(by) ? by : 1;
    this.values[key] = (this.values[key] || 0) + (amt as number);
  }

  set(key: CounterKey, value: number) {
    this.values[key] = Math.max(0, Math.floor(value));
  }

  get(key: CounterKey): number {
    return this.values[key] || 0;
  }

  snapshot(): Snapshot {
    return { ...this.values };
  }

  resetAll() {
    (Object.keys(this.values) as CounterKey[]).forEach((k) => (this.values[k] = 0));
  }
}

export const counters = new Counters();

export default counters;

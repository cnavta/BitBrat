import { checkAndUpdateRateLimit, effectiveRateLimit, currentWindowKey } from '../../../src/services/command-processor/policy';
import type { CommandDoc } from '../../../src/services/command-processor/command-repo';

function makeRateRef(options: { exists: boolean; count: number }) {
  const updates: any[] = [];
  const sets: any[] = [];
  const ref: any = {
    firestore: {
      runTransaction: async (fn: any) => {
        const tx = {
          get: async (_ref: any) => ({
            exists: options.exists,
            data: () => ({ count: options.count, windowStartAt: '2025-01-01T00:00:00.000Z' }),
          }),
          update: (_ref: any, patch: any) => {
            updates.push(patch);
          },
          set: (_ref: any, payload: any) => {
            sets.push(payload);
          },
        };
        return await fn(tx);
      },
    },
    // Minimal collection/doc chain to satisfy rateWindowRef(commandRef,...)
    collection: (_name: string) => ({
      doc: (_id: string) => ({
        collection: (_inner: string) => ({
          doc: (_innerId: string) => ({ /* leaf doc ref object */ }),
        }),
      }),
    }),
  };
  return { ref, updates, sets } as const;
}

describe('policy.rateLimit', () => {
  it('computes effective rate limit from doc or defaults', () => {
    const base: CommandDoc = { id: '1', name: 'c', templates: [], matchType: { kind: 'command', values: ['c'], priority: 0 } };
    expect(effectiveRateLimit(base, { max: 0, perMs: 60000 })).toBeNull();
    expect(effectiveRateLimit({ ...base, rateLimit: { max: 5, perMs: 10000 } }, { max: 0, perMs: 60000 })).toEqual({ max: 5, perMs: 10000 });
    expect(effectiveRateLimit(base, { max: 3, perMs: 15000 })).toEqual({ max: 3, perMs: 15000 });
  });

  it('currentWindowKey stays stable within window and rolls over across boundary', () => {
    const t1 = new Date('2025-01-01T00:00:05.000Z');
    const t2 = new Date('2025-01-01T00:00:14.999Z');
    const t3 = new Date('2025-01-01T00:00:15.000Z');
    const w1 = currentWindowKey(t1, 15000);
    const w2 = currentWindowKey(t2, 15000);
    const w3 = currentWindowKey(t3, 15000);
    expect(w1.key).toBe(w2.key);
    expect(w3.key).not.toBe(w1.key);
  });

  it('allows until count < max then denies at >= max', async () => {
    const doc: CommandDoc = { id: '1', name: 'c', templates: [], matchType: { kind: 'command', values: ['c'], priority: 0 }, rateLimit: { max: 2, perMs: 60000 } };
    const now = new Date('2025-01-01T00:00:10.000Z');

    // Case 0 → allow and set to 1
    {
      const { ref, updates, sets } = makeRateRef({ exists: false, count: 0 });
      const res = await checkAndUpdateRateLimit(ref as any, doc, now, { max: 0, perMs: 60000 });
      expect(res.allowed).toBe(true);
      expect(sets.length + updates.length).toBeGreaterThan(0);
    }

    // Case 1 → allow and update to 2
    {
      const { ref, updates, sets } = makeRateRef({ exists: true, count: 1 });
      const res = await checkAndUpdateRateLimit(ref as any, doc, now, { max: 0, perMs: 60000 });
      expect(res.allowed).toBe(true);
      expect(updates.length).toBe(1);
    }

    // Case 2 → deny and no write
    {
      const { ref, updates, sets } = makeRateRef({ exists: true, count: 2 });
      const res = await checkAndUpdateRateLimit(ref as any, doc, now, { max: 0, perMs: 60000 });
      expect(res.allowed).toBe(false);
      expect(res.code).toBe('RATE_LIMIT');
      expect(updates.length + sets.length).toBe(0);
    }
  });
});

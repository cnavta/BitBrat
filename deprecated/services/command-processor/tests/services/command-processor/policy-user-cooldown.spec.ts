import { checkAndUpdateUserCooldown, effectivePerUserCooldownMs } from '../../../src/services/command-processor/policy';
import type { CommandDoc } from '../../../src/services/command-processor/command-repo';

function makeRefForUser(lastExecutionAt?: string | null) {
  const updates: any[] = [];
  const sets: any[] = [];
  const ref: any = {
    firestore: {
      runTransaction: async (fn: any) => {
        const tx = {
          get: async (_ref: any) => ({
            exists: lastExecutionAt !== null,
            data: () => (lastExecutionAt !== null ? { lastExecutionAt: lastExecutionAt || undefined } : {}),
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
    // Minimal collection/doc chain to satisfy userCooldownRef()
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

describe('policy.userCooldown', () => {
  it('computes effective per-user cooldown with override and defaults', () => {
    const doc: CommandDoc = { id: '1', name: 'c', templates: [], matchType: { kind: 'command', values: ['c'], priority: 0 } };
    expect(effectivePerUserCooldownMs(doc, 0)).toBe(0);
    expect(effectivePerUserCooldownMs({ ...doc, cooldowns: { perUserMs: 3000 } }, 0)).toBe(3000);
    expect(effectivePerUserCooldownMs(doc, 5000)).toBe(5000);
  });

  it('allows when per-user cooldown disabled', async () => {
    const { ref, updates, sets } = makeRefForUser(null);
    const doc: CommandDoc = { id: '1', name: 'c', templates: [], matchType: { kind: 'command', values: ['c'], priority: 0 }, cooldowns: { perUserMs: 0 } };
    const now = new Date();
    const res = await checkAndUpdateUserCooldown(ref as any, doc, 'user-1', now, 0);
    expect(res.allowed).toBe(true);
    expect(updates.length + sets.length).toBe(0);
  });

  it('blocks when within per-user window', async () => {
    const now = new Date('2025-01-01T00:00:10.000Z');
    const eightSecondsAgo = new Date('2025-01-01T00:00:02.000Z').toISOString();
    const { ref, updates, sets } = makeRefForUser(eightSecondsAgo);
    const doc: CommandDoc = { id: '1', name: 'c', templates: [], matchType: { kind: 'command', values: ['c'], priority: 0 }, cooldowns: { perUserMs: 15000 } };
    const res = await checkAndUpdateUserCooldown(ref as any, doc, 'u-1', now, 0);
    expect(res.allowed).toBe(false);
    expect(updates.length + sets.length).toBe(0);
  });

  it('allows and writes when outside window (creates or updates record)', async () => {
    const now = new Date('2025-01-01T00:00:20.000Z');
    // Simulate no existing record: lastExecutionAt is null meaning snap.exists === false
    const { ref, updates, sets } = makeRefForUser(null);
    const doc: CommandDoc = { id: '1', name: 'c', templates: [], matchType: { kind: 'command', values: ['c'], priority: 0 }, cooldowns: { perUserMs: 1000 } };
    const res = await checkAndUpdateUserCooldown(ref as any, doc, 'u-2', now, 0);
    expect(res.allowed).toBe(true);
    // Should perform a write (set in this stub)
    expect(updates.length + sets.length).toBeGreaterThan(0);
  });
});

import { checkAndUpdateGlobalCooldown, effectiveGlobalCooldownMs } from '../../../src/services/command-processor/policy';
import type { CommandDoc } from '../../../src/services/command-processor/command-repo';

function makeRef(lastExecutionAt?: string) {
  const updates: any[] = [];
  const ref: any = {
    firestore: {
      runTransaction: async (fn: any) => {
        const tx = {
          get: async (_ref: any) => ({
            exists: true,
            data: () => ({ runtime: lastExecutionAt ? { lastExecutionAt } : {} }),
          }),
          update: (_ref: any, patch: any) => {
            updates.push(patch);
          },
        };
        return await fn(tx);
      },
    },
  };
  return { ref, updates } as const;
}

describe('policy.globalCooldown', () => {
  it('computes effective cooldown with override and defaults', () => {
    const doc: CommandDoc = { id: '1', name: 'test', templates: [] };
    expect(effectiveGlobalCooldownMs(doc, 0)).toBe(0);
    expect(effectiveGlobalCooldownMs({ ...doc, cooldowns: { globalMs: 5000 } }, 0)).toBe(5000);
    expect(effectiveGlobalCooldownMs(doc, 60000)).toBe(60000);
  });

  it('allows when cooldown disabled', async () => {
    const { ref, updates } = makeRef();
    const doc: CommandDoc = { id: '1', name: 'test', templates: [], cooldowns: { globalMs: 0 } };
    const now = new Date();
    const res = await checkAndUpdateGlobalCooldown(ref as any, doc, now, 0);
    expect(res.allowed).toBe(true);
    expect(updates.length).toBe(0);
  });

  it('blocks when within window and allows when outside', async () => {
    const now = new Date('2025-01-01T00:00:10.000Z');
    const tenSecondsAgo = new Date('2025-01-01T00:00:01.000Z').toISOString();
    const { ref, updates } = makeRef(tenSecondsAgo);
    const doc: CommandDoc = { id: '1', name: 't', templates: [], cooldowns: { globalMs: 15000 } };

    // Within 15s window → blocked
    const blocked = await checkAndUpdateGlobalCooldown(ref as any, doc, now, 0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.code).toBe('GLOBAL_COOLDOWN');
    expect(updates.length).toBe(0);

    // Move time beyond window → allowed and updates runtime
    const later = new Date('2025-01-01T00:00:20.500Z');
    const allowed = await checkAndUpdateGlobalCooldown(ref as any, doc, later, 0);
    expect(allowed.allowed).toBe(true);
    expect(updates.length).toBe(1);
    expect(Object.keys(updates[0])).toContain('runtime.lastExecutionAt');
  });
});

import { processEvent } from '../../../src/services/command-processor/processor';
import { overrideConfig, resetConfig } from '../../../src/common/config';
import type { InternalEventV2 } from '../../../src/types/events';

function evt(text: string): InternalEventV2 {
  return {
    v: '1',
    source: 'test',
    correlationId: 'c-ml-1',
    type: 'internal.command.v1',
    message: { id: 'm1', role: 'user', text },
    user: { id: 'u-1' },
  } as any;
}

describe('command-processor termLocation matching & args', () => {
  afterEach(() => {
    resetConfig();
  });

  it('prefix: parses parentheses-only args and ignores trailing text for args', async () => {
    const e = evt('!hum(hi,4) extra words');
    const doc = { id: 'd1', name: 'hum', termLocation: 'prefix', sigil: '!', templates: [{ id: 't', text: 'ok' }] } as any;
    const deps = {
      repoFindByNameOrAlias: jest.fn(async (name: string) => (name === 'hum' ? { ref: { firestore: {} } as any, doc } : null)),
      policy: { checkAndUpdateGlobalCooldown: async () => ({ allowed: true }), checkAndUpdateUserCooldown: async () => ({ allowed: true }), checkAndUpdateRateLimit: async () => ({ allowed: true }) },
      rng: () => 0,
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    } as any;
    const res = await processEvent(e, deps);
    expect(res.action).toBe('produced');
    const cand = res.event.candidates![0];
    expect(cand.metadata?.args).toEqual(['hi,4']);
  });

  it('suffix: matches only at end and parses optional parentheses payload', async () => {
    const e = evt('please finish !bye(42)');
    const doc = { id: 'd2', name: 'bye', termLocation: 'suffix', sigil: '!', templates: [{ id: 't', text: 'ok' }] } as any;
    const deps = {
      repoFindByNameOrAlias: jest.fn(async (name: string) => (name === 'bye' ? { ref: { firestore: {} } as any, doc } : null)),
      policy: { checkAndUpdateGlobalCooldown: async () => ({ allowed: true }), checkAndUpdateUserCooldown: async () => ({ allowed: true }), checkAndUpdateRateLimit: async () => ({ allowed: true }) },
      rng: () => 0,
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    } as any;
    const res = await processEvent(e, deps);
    expect(res.action).toBe('produced');
    const cand = res.event.candidates![0];
    expect(cand.metadata?.args).toEqual(['42']);
  });

  it('anywhere: enforces whitespace boundaries and allows parentheses args only', async () => {
    const e1 = evt('please !help now');
    const e2 = evt('please!help now'); // should NOT match due to no whitespace boundary
    const doc = { id: 'd3', name: 'help', termLocation: 'anywhere', sigil: '!', templates: [{ id: 't', text: 'ok' }] } as any;
    const deps = {
      repoFindByNameOrAlias: jest.fn(async (name: string) => (name === 'help' ? { ref: { firestore: {} } as any, doc } : null)),
      policy: { checkAndUpdateGlobalCooldown: async () => ({ allowed: true }), checkAndUpdateUserCooldown: async () => ({ allowed: true }), checkAndUpdateRateLimit: async () => ({ allowed: true }) },
      rng: () => 0,
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    } as any;
    const r1 = await processEvent(e1, deps);
    expect(r1.action).toBe('produced');
    const r2 = await processEvent(e2, deps);
    expect(r2.action).toBe('skip');
  });

  it('ALLOWED_SIGILS: disallows matching when doc sigil is not whitelisted', async () => {
    // Only '!' is allowed; doc requires '::'
    overrideConfig({ allowedSigils: ['!'], commandSigil: '!' });
    const e = evt('!ping');
    const doc = { id: 'd4', name: 'ping', termLocation: 'prefix', sigil: '::', sigilOptional: false, templates: [{ id: 't', text: 'ok' }] } as any;
    const deps = {
      repoFindByNameOrAlias: jest.fn(async (name: string) => (name === 'ping' ? { ref: { firestore: {} } as any, doc } : null)),
      policy: { checkAndUpdateGlobalCooldown: async () => ({ allowed: true }), checkAndUpdateUserCooldown: async () => ({ allowed: true }), checkAndUpdateRateLimit: async () => ({ allowed: true }) },
      rng: () => 0,
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    } as any;
    const res = await processEvent(e, deps);
    expect(res.action).toBe('skip');
  });
});

import { processEvent } from '../../../src/services/command-processor/processor';
import type { InternalEventV2 } from '../../../src/types/events';

function makeEvent(text: string, withUser = true): InternalEventV2 {
  const evt: InternalEventV2 = {
    v: '1',
    source: 'test',
    correlationId: 'c-1',
    type: 'internal.command.v1',
    message: { id: 'm1', role: 'user', text },
  } as any;
  if (withUser) (evt as any).user = { id: 'u-1', displayName: 'Alice' };
  return evt;
}

describe('command-processor.processEvent', () => {
  it('produces a candidate for a valid command (happy path)', async () => {
    const evt = makeEvent('!ping');
    const doc = { id: 'cmd1', name: 'ping', templates: [{ id: 't1', text: 'Pong {{username}}' }] } as any;
    const deps = {
      repoFindByNameOrAlias: async (_name: string) => ({ ref: { firestore: {} } as any, doc }),
      policy: {
        checkAndUpdateGlobalCooldown: async () => ({ allowed: true }),
        checkAndUpdateUserCooldown: async () => ({ allowed: true }),
        checkAndUpdateRateLimit: async () => ({ allowed: true }),
      },
      rng: () => 0,
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    } as any;
    const res = await processEvent(evt, deps);
    expect(res.action).toBe('produced');
    expect(res.stepStatus).toBe('OK');
    expect(res.event.candidates && res.event.candidates.length).toBe(1);
    expect(res.event.candidates![0].text).toContain('Alice');
  });

  it('produces an annotation when command type=annotation', async () => {
    const evt = makeEvent('!note');
    const doc = {
      id: 'cmdA',
      name: 'note',
      type: 'annotation',
      annotationKind: 'prompt',
      templates: [{ id: 't1', text: 'Saved {{username}}' }],
    } as any;
    const deps = {
      repoFindByNameOrAlias: async (_name: string) => ({ ref: { firestore: {} } as any, doc }),
      policy: {
        checkAndUpdateGlobalCooldown: async () => ({ allowed: true }),
        checkAndUpdateUserCooldown: async () => ({ allowed: true }),
        checkAndUpdateRateLimit: async () => ({ allowed: true }),
      },
      rng: () => 0,
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    } as any;
    const res = await processEvent(evt, deps);
    expect(res.action).toBe('produced');
    expect(res.stepStatus).toBe('OK');
    expect((res.event.annotations || []).length).toBe(1);
    expect(res.event.annotations![0].kind).toBe('prompt');
    expect(res.event.annotations![0].label).toBe('note');
    expect(res.event.annotations![0].value).toContain('Alice');
    expect(res.event.candidates || []).toHaveLength(0);
  });

  it('blocks when per-user cooldown denies', async () => {
    const evt = makeEvent('!cool');
    const doc = { id: 'cmd3', name: 'cool', templates: [{ id: 't1', text: 'ok' }] } as any;
    const deps = {
      repoFindByNameOrAlias: async () => ({ ref: { firestore: {} } as any, doc }),
      policy: {
        checkAndUpdateGlobalCooldown: async () => ({ allowed: true }),
        checkAndUpdateUserCooldown: async () => ({ allowed: false, code: 'USER_COOLDOWN' }),
        checkAndUpdateRateLimit: async () => ({ allowed: true }),
      },
      rng: () => 0,
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    } as any;
    const res = await processEvent(evt, deps);
    expect(res.action).toBe('blocked');
    expect(res.stepStatus).toBe('SKIP');
    expect(res.reason).toBe('user-cooldown');
    expect(res.event.candidates || []).toHaveLength(0);
    expect(res.event.annotations || []).toHaveLength(0);
  });

  it('skips when command is not found', async () => {
    const evt = makeEvent('!missing');
    const deps = {
      repoFindByNameOrAlias: async () => null,
      policy: {
        checkAndUpdateGlobalCooldown: async () => ({ allowed: true }),
        checkAndUpdateUserCooldown: async () => ({ allowed: true }),
        checkAndUpdateRateLimit: async () => ({ allowed: true }),
      },
      rng: () => 0,
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    } as any;
    const res = await processEvent(evt, deps);
    expect(res.action).toBe('skip');
    expect(res.stepStatus).toBe('SKIP');
    expect(res.event.candidates || []).toHaveLength(0);
  });

  it('blocks when rate limit denies', async () => {
    const evt = makeEvent('!rate');
    const doc = { id: 'cmd2', name: 'rate', templates: [{ id: 't1', text: 'ok' }] } as any;
    const deps = {
      repoFindByNameOrAlias: async () => ({ ref: { firestore: {} } as any, doc }),
      policy: {
        checkAndUpdateGlobalCooldown: async () => ({ allowed: true }),
        checkAndUpdateUserCooldown: async () => ({ allowed: true }),
        checkAndUpdateRateLimit: async () => ({ allowed: false, code: 'RATE_LIMIT' }),
      },
      rng: () => 0,
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    } as any;
    const res = await processEvent(evt, deps);
    expect(res.action).toBe('blocked');
    expect(res.stepStatus).toBe('SKIP');
    expect(res.reason).toBe('rate-limit');
    expect(res.event.candidates || []).toHaveLength(0);
  });
});

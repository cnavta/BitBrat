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

describe('command-processor personality annotation', () => {
  const commonPolicy = {
    checkAndUpdateGlobalCooldown: async () => ({ allowed: true }),
    checkAndUpdateUserCooldown: async () => ({ allowed: true }),
    checkAndUpdateRateLimit: async () => ({ allowed: true }),
  };

  it('appends personality annotation for candidate commands when bot.personality is present', async () => {
    const evt = makeEvent('!greet');
    const doc = {
      id: 'cmd-p1',
      name: 'greet',
      templates: [{ id: 't1', text: 'Hello {{username}}' }],
      bot: { personality: 'snarky' },
    } as any;
    const deps = {
      repoFindByNameOrAlias: async () => ({ ref: { firestore: {} } as any, doc }),
      policy: commonPolicy,
      rng: () => 0,
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    } as any;
    const res = await processEvent(evt, deps);
    expect(res.action).toBe('produced');
    // Should produce one candidate and one personality annotation
    expect((res.event.candidates || []).length).toBe(1);
    const anns = res.event.annotations || [];
    expect(anns.length).toBe(1);
    expect(anns[0].kind).toBe('personality');
    expect(anns[0].payload?.name).toBe('snarky');
    expect(anns[0].source).toBe('command-processor');
  });

  it('appends personality alongside existing annotation effects', async () => {
    const evt = makeEvent('!note');
    const doc = {
      id: 'cmd-p2',
      name: 'note',
      type: 'annotation',
      annotationKind: 'prompt',
      templates: [{ id: 't1', text: 'Saved {{username}}' }],
      bot: { personality: 'friendly' },
    } as any;
    const deps = {
      repoFindByNameOrAlias: async () => ({ ref: { firestore: {} } as any, doc }),
      policy: commonPolicy,
      rng: () => 0,
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    } as any;
    const res = await processEvent(evt, deps);
    expect(res.action).toBe('produced');
    const anns = res.event.annotations || [];
    // one from effect + one from personality
    expect(anns.length).toBe(2);
    expect(anns.some((a) => a.kind === 'prompt')).toBeTruthy();
    expect(anns.some((a) => a.kind === 'personality' && a.payload?.name === 'friendly')).toBeTruthy();
    expect(res.event.candidates || []).toHaveLength(0);
  });

  it('does not add annotation when bot.personality is missing', async () => {
    const evt = makeEvent('!noop');
    const doc = { id: 'cmd-p3', name: 'noop', templates: [{ id: 't1', text: 'ok' }] } as any;
    const deps = {
      repoFindByNameOrAlias: async () => ({ ref: { firestore: {} } as any, doc }),
      policy: commonPolicy,
      rng: () => 0,
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    } as any;
    const res = await processEvent(evt, deps);
    expect(res.action).toBe('produced');
    expect(res.event.annotations || []).toHaveLength(0);
  });

  it('does not add annotation when bot.personality is not a string or empty', async () => {
    const evt = makeEvent('!noop');
    const doc = {
      id: 'cmd-p4',
      name: 'noop',
      templates: [{ id: 't1', text: 'ok' }],
      bot: { personality: '   ' },
    } as any;
    const deps = {
      repoFindByNameOrAlias: async () => ({ ref: { firestore: {} } as any, doc }),
      policy: commonPolicy,
      rng: () => 0,
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    } as any;
    const res = await processEvent(evt, deps);
    expect(res.action).toBe('produced');
    expect(res.event.annotations || []).toHaveLength(0);

    const evt2 = makeEvent('!noop');
    const doc2 = { id: 'cmd-p5', name: 'noop', templates: [{ id: 't1', text: 'ok' }], bot: { personality: 42 as any } } as any;
    const deps2 = { ...deps, repoFindByNameOrAlias: async () => ({ ref: { firestore: {} } as any, doc: doc2 }) } as any;
    const res2 = await processEvent(evt2, deps2);
    expect(res2.action).toBe('produced');
    expect(res2.event.annotations || []).toHaveLength(0);
  });
});

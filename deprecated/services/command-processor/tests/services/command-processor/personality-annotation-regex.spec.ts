import { processEvent } from '../../../src/services/command-processor/processor';
import type { InternalEventV2 } from '../../../src/types/events';

function makeEvent(text: string, withUser = true): InternalEventV2 {
  const evt: InternalEventV2 = {
    v: '1',
    source: 'test',
    correlationId: 'c-2',
    type: 'internal.command.v1',
    message: { id: 'm2', role: 'user', text },
  } as any;
  if (withUser) (evt as any).user = { id: 'u-2', displayName: 'Bob' };
  return evt;
}

describe('command-processor personality annotation via regex match', () => {
  const commonPolicy = {
    checkAndUpdateGlobalCooldown: async () => ({ allowed: true }),
    checkAndUpdateUserCooldown: async () => ({ allowed: true }),
    checkAndUpdateRateLimit: async () => ({ allowed: true }),
  };

  it('appends personality when matched by regex-cache compiled entry with bot.personality', async () => {
    const evt = makeEvent('hello there');
    const doc = {
      id: 'regex-1',
      name: 'hello-cmd',
      type: 'candidate',
      matchType: { kind: 'regex', values: ['/hello/i'], priority: 0 },
      templates: [{ id: 't1', text: 'Howdy {{username}}' }],
      bot: { personality: 'friendly' },
    } as any;

    const deps = {
      repoFindByNameOrAlias: async () => null, // force regex path
      policy: commonPolicy,
      rng: () => 0,
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      getRegexCompiled: () => [{ ref: { firestore: {} } as any, doc, patterns: [/hello/i] }],
    } as any;

    const res = await processEvent(evt, deps);
    expect(res.action).toBe('produced');
    // Candidate produced
    expect((res.event.candidates || []).length).toBe(1);
    // Personality annotation appended
    const anns = res.event.annotations || [];
    expect(anns.some((a) => a.kind === 'personality' && a.payload?.name === 'friendly')).toBeTruthy();
  });
});

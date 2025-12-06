import { processEvent } from '../../src/services/command-processor/processor';
import type { InternalEventV2 } from '../../src/types/events';

function makeV2(text: string): InternalEventV2 {
  return {
    v: '1',
    source: 'ingress.test',
    correlationId: 'c-smoke-1',
    routingSlip: [{ id: 'command-processor', status: 'PENDING', nextTopic: 'internal.egress.v1' }],
    type: 'chat.command.v1',
    channel: '#chan',
    userId: 'u-1',
    message: { id: 'm-1', role: 'user', text },
  } as any;
}

describe('integration smoke: V2 → candidate append', () => {
  it('produces a candidate and preserves top-level envelope fields', async () => {
    const v2In = makeV2('!hello world');
    const deps = {
      repoFindByNameOrAlias: async () => ({ ref: { firestore: {} } as any, doc: { id: 'cmd-hello', name: 'hello', templates: [{ id: 't1', text: 'Hello {{username}}' }] } }),
      policy: {
        checkAndUpdateGlobalCooldown: async () => ({ allowed: true }),
        checkAndUpdateUserCooldown: async () => ({ allowed: true }),
        checkAndUpdateRateLimit: async () => ({ allowed: true }),
      },
      rng: () => 0,
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    } as any;

    const outcome = await processEvent(v2In as any, deps);
    expect(outcome.action).toBe('produced');
    const v2 = outcome.event as InternalEventV2;
    expect(v2.v).toBe('1');
    expect(v2.correlationId).toBe('c-smoke-1');
    expect(v2.type).toBe('chat.command.v1');
    expect(Array.isArray(v2.candidates)).toBe(true);
    expect((v2.candidates || []).length).toBe(1);
    expect((v2.candidates || [])[0].kind).toBe('text');
    expect((v2.candidates || [])[0].status).toBe('proposed');
  });
});

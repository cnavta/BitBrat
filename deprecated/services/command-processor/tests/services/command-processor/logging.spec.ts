import { processEvent } from '../../../src/services/command-processor/processor';
import { logger } from '../../../src/common/logging';
import type { InternalEventV2 } from '../../../src/types/events';

function makeEvent(text: string): InternalEventV2 {
  return {
    v: '1',
    source: 'test',
    correlationId: 'c-log-1',
    type: 'chat.command.v1',
    message: { id: 'm1', role: 'user', text },
    user: { id: 'u1', displayName: 'Alice' } as any,
  } as any;
}

describe('command-processor logging', () => {
  it('logs matched command, template chosen, and candidate added', async () => {
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation((() => {}) as any);
    const deps = {
      repoFindByNameOrAlias: async () => ({ ref: { id: 'doc-1', firestore: {} } as any, doc: { id: 'doc-1', name: 'ping', templates: [{ id: 't1', text: 'Pong {{username}}' }] } }),
      policy: {
        checkAndUpdateGlobalCooldown: async () => ({ allowed: true }),
        checkAndUpdateUserCooldown: async () => ({ allowed: true }),
        checkAndUpdateRateLimit: async () => ({ allowed: true }),
      },
      rng: () => 0,
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    } as any;

    const evt = makeEvent('!ping');
    const res = await processEvent(evt, deps);
    expect(res.action).toBe('produced');

    // Assert specific log events were emitted
    const hasMatched = infoSpy.mock.calls.some((c) => c[0] === 'command_processor.command.matched');
    const hasChosen = infoSpy.mock.calls.some((c) => c[0] === 'command_processor.template.chosen');
    const hasCandidate = infoSpy.mock.calls.some((c) => c[0] === 'command_processor.candidate.added');
    expect(hasMatched).toBe(true);
    expect(hasChosen).toBe(true);
    expect(hasCandidate).toBe(true);
  });
});

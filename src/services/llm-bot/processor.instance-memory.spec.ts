import { processEvent } from './processor';
import { BaseServer } from '../../common/base-server';
import type { InternalEventV2 } from '../../types/events';
import { __resetInstanceMemoryStoreForTests } from './instance-memory';

class TestServer extends BaseServer { constructor() { super({ serviceName: 'test-llm-bot' }); } }

function baseEvt(): InternalEventV2 {
  return {
    v: '1',
    source: 'test',
    correlationId: 'c-inst',
    type: 'llm.request.v1',
    channel: 'twitch',
    user: { id: 'u1' } as any,
    message: { id: 'm1', role: 'user', text: 'hello' },
    routingSlip: [{ id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.finalize.v1' }],
  } as any;
}

describe('llm-bot instance-scoped memory across events', () => {
  beforeEach(() => {
    __resetInstanceMemoryStoreForTests();
  });

  test('second event includes prior turns from instance memory', async () => {
    const server = new TestServer();
    const evt1 = baseEvt();
    evt1.annotations = [
      { id: 'p1', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'First question' },
    ] as any;

    // First call: return assistant reply A1
    const status1 = await processEvent(server, evt1, {
      callLLM: async () => 'A1',
    });
    expect(status1).toBe('OK');

    // Second event for same key (same channel:user)
    const evt2 = baseEvt();
    evt2.annotations = [
      { id: 'p2', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'Second question' },
    ] as any;

    let captured = '';
    const status2 = await processEvent(server, evt2, {
      callLLM: async (_m, input) => { captured = input; return 'A2'; },
    });
    expect(status2).toBe('OK');
    // And the new prompt should be present in the assembled payload
    expect(captured).toContain('Second question');
  });

  test('different keys are isolated', async () => {
    const server = new TestServer();
    const evtA = baseEvt();
    evtA.user = { id: 'uA' } as any;
    evtA.annotations = [ { id: 'a', kind: 'prompt', source: 't', createdAt: new Date().toISOString(), value: 'From A' } ] as any;
    await processEvent(server, evtA, { callLLM: async () => 'respA' });

    const evtB = baseEvt();
    evtB.user = { id: 'uB' } as any;
    evtB.annotations = [ { id: 'b', kind: 'prompt', source: 't', createdAt: new Date().toISOString(), value: 'From B' } ] as any;
    let captured = '';
    await processEvent(server, evtB, { callLLM: async (_m, input) => { captured = input; return 'respB'; } });
    expect(captured).toContain('From B');
    expect(captured).not.toContain('From A');
    expect(captured).not.toContain('respA');
  });
});

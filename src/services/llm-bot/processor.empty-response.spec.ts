import { processEvent } from './processor';
import { BaseServer } from '../../common/base-server';
import type { InternalEventV2 } from '../../types/events';

class TestServer extends BaseServer { constructor() { super({ serviceName: 'test-llm-bot' }); } }

function baseEvt(): InternalEventV2 {
  return {
    v: '1',
    source: 'test',
    correlationId: 'c-empty',
    type: 'llm.request.v1',
    message: { id: 'm1', role: 'user', text: 'hello' },
    routingSlip: [{ id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.finalize.v1' }],
    annotations: [
      { id: 'a1', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'Say hi' },
    ] as any,
  } as any;
}

describe('llm-bot should not add blank candidates', () => {
  test('no candidate when LLM returns empty string', async () => {
    const server = new TestServer();
    const evt = baseEvt();
    const status = await processEvent(server, evt, { callLLM: async () => '' });
    expect(status).toBe('OK');
    expect(evt.candidates).toBeUndefined();
  });

  test('no candidate when LLM returns whitespace only', async () => {
    const server = new TestServer();
    const evt = baseEvt();
    const status = await processEvent(server, evt, { callLLM: async () => '   \n  ' });
    expect(status).toBe('OK');
    expect(evt.candidates).toBeUndefined();
  });
});

import { processEvent } from './processor';
import { BaseServer } from '../../common/base-server';
import { InternalEventV2 } from '../../types/events';

class TestServer extends BaseServer { constructor() { super({ serviceName: 'test-llm-bot' }); } }

function baseEvt(): InternalEventV2 {
  return {
    v: '2',
    source: 'test',
    correlationId: 'c-1',
    type: 'llm.request.v1',
    message: { id: 'm1', role: 'user', text: 'hello' },
    routingSlip: [{ id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.finalize.v1' }],
  } as any;
}

describe('llm-bot processor', () => {
  test('SKIP when no prompt annotations', async () => {
    const server = new TestServer();
    const evt = baseEvt();
    const status = await processEvent(server, evt, { callLLM: async () => 'should not be called' });
    expect(status).toBe('SKIP');
    expect(evt.candidates).toBeUndefined();
  });

  test('OK and candidate appended when prompt annotations exist', async () => {
    const server = new TestServer();
    const evt = baseEvt();
    evt.annotations = [
      { id: 'a1', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'Say hi' },
    ] as any;
    const status = await processEvent(server, evt, { callLLM: async () => 'Hi there!' });
    expect(status).toBe('OK');
    expect(Array.isArray(evt.candidates)).toBe(true);
    expect(evt.candidates![0].text).toContain('Hi');
  });

  test('Adaptive Model Selection: selects gpt-4o for questions', async () => {
    const server = new TestServer();
    const evt = baseEvt();
    evt.annotations = [
      { id: 'a1', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'Answer this' },
      { id: 'a2', kind: 'intent', source: 'query-analyzer', createdAt: new Date().toISOString(), label: 'question' },
    ] as any;

    let selectedModel = '';
    const status = await processEvent(server, evt, {
      callLLM: async (model) => {
        selectedModel = model;
        return 'The answer is 42.';
      }
    });

    expect(status).toBe('OK');
    expect(selectedModel).toBe('gpt-4o');
  });

  test('Adaptive Model Selection: selects gpt-4o-mini for jokes', async () => {
    const server = new TestServer();
    const evt = baseEvt();
    evt.annotations = [
      { id: 'a1', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'Tell a joke' },
      { id: 'a2', kind: 'intent', source: 'query-analyzer', createdAt: new Date().toISOString(), label: 'joke' },
    ] as any;

    let selectedModel = '';
    const status = await processEvent(server, evt, {
      callLLM: async (model) => {
        selectedModel = model;
        return 'Why did the chicken cross the road?';
      }
    });

    expect(status).toBe('OK');
    expect(selectedModel).toBe('gpt-4o-mini');
  });
});

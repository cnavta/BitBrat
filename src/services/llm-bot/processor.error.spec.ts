import { processEvent } from './processor';
import { BaseServer } from '../../common/base-server';
import type { InternalEventV2 } from '../../types/events';

class TestServer extends BaseServer { constructor() { super({ serviceName: 'test-llm-bot' }); } }

function baseEvt(): InternalEventV2 {
  return {
    v: '2',
    source: 'test',
    correlationId: 'c-error',
    type: 'llm.request.v1',
    message: { id: 'm1', role: 'user', text: 'hello' },
    routingSlip: [{ id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.finalize.v1' }],
    annotations: [
      { id: 'a1', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'Say hi' },
    ] as any,
  } as any;
}

describe('llm-bot error path', () => {
  const OLD = {
    USER_CTX: process.env.USER_CONTEXT_ENABLED,
    DISP: process.env.DISPOSITION_PROMPT_INJECTION_ENABLED,
  };

  beforeAll(() => {
    process.env.USER_CONTEXT_ENABLED = 'false';
    process.env.DISPOSITION_PROMPT_INJECTION_ENABLED = 'false';
  });

  afterAll(() => {
    if (OLD.USER_CTX === undefined) delete process.env.USER_CONTEXT_ENABLED; else process.env.USER_CONTEXT_ENABLED = OLD.USER_CTX;
    if (OLD.DISP === undefined) delete process.env.DISPOSITION_PROMPT_INJECTION_ENABLED; else process.env.DISPOSITION_PROMPT_INJECTION_ENABLED = OLD.DISP;
  });

  test('returns ERROR and records evt.errors when model call throws', async () => {
    const server = new TestServer();
    const evt = baseEvt();
    const status = await processEvent(server, evt, {
      callLLM: async () => {
        throw new Error('boom');
      },
    });
    expect(status).toBe('ERROR');
    expect(Array.isArray(evt.errors)).toBe(true);
    expect(evt.errors![0].source).toBe('llm-bot');
    expect(evt.errors![0].message).toContain('boom');
  });
});

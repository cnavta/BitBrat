import { processEvent } from './processor';
import { BaseServer } from '../../common/base-server';
import type { InternalEventV2 } from '../../types/events';

class TestServer extends BaseServer { constructor() { super({ serviceName: 'test-llm-bot' }); } }

function baseEvt(): InternalEventV2 {
  return {
    v: '1',
    source: 'test',
    correlationId: 'c-pers',
    type: 'llm.request.v1',
    message: { id: 'm1', role: 'user', text: 'hello' },
    routingSlip: [{ id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.finalize.v1' }],
  } as any;
}

describe('llm-bot processor with personality', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('composes system prompt with inline personality (append mode)', async () => {
    process.env.PERSONALITY_ENABLED = 'true';
    process.env.LLM_BOT_SYSTEM_PROMPT = 'BASE';
    const server = new TestServer();
    const evt = baseEvt();
    // Add both a personality annotation and a prompt annotation to trigger call_model
    evt.annotations = [
      { id: 'p1', kind: 'personality', source: 'test', createdAt: new Date().toISOString(), payload: { text: 'PERS' } },
      { id: 'a1', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'Say hi' },
    ] as any;

    let capturedInput = '';
    const status = await processEvent(server, evt, {
      callLLM: async (_model, input) => {
        capturedInput = input;
        return 'ok';
      },
    });
    expect(status).toBe('OK');
    // System portion should contain BASE and personality text mapped into Identity (aggregated under system via adapter)
    expect(capturedInput).toContain('(system)');
    expect(capturedInput).toContain('BASE');
    expect(capturedInput).toContain('PERS');
    // User content should include Task and Input sections with the prompt and base text
    expect(capturedInput).toContain('## [Task]');
    expect(capturedInput).toContain('Say hi');
    expect(capturedInput).toContain('## [Input]');
    expect(capturedInput).toContain('hello');
  });
});

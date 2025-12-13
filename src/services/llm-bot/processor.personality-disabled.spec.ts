import { processEvent } from './processor';
import { BaseServer } from '../../common/base-server';
import type { InternalEventV2 } from '../../types/events';

class TestServer extends BaseServer { constructor() { super({ serviceName: 'test-llm-bot' }); } }

function baseEvt(): InternalEventV2 {
  return {
    v: '1',
    source: 'test',
    correlationId: 'c-pers-disabled',
    type: 'llm.request.v1',
    message: { id: 'm1', role: 'user', text: 'hello' },
    routingSlip: [{ id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.finalize.v1' }],
  } as any;
}

describe('llm-bot processor with personality disabled', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('does not include personality text when PERSONALITY_ENABLED=false', async () => {
    process.env.PERSONALITY_ENABLED = 'false';
    process.env.LLM_BOT_SYSTEM_PROMPT = 'BASE';
    const server = new TestServer();
    const evt = baseEvt();
    // Include both a personality (should be ignored) and a prompt (to trigger model call)
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
    // Should contain the base system prompt but not the personality text
    expect(capturedInput).toContain('(system) BASE');
    expect(capturedInput).not.toContain('PERS');
    // Should include user turns
    expect(capturedInput).toContain('(user) hello');
    expect(capturedInput).toContain('(user) Say hi');
  });
});

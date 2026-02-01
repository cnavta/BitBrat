import { processEvent } from '../processor';
import { BaseServer } from '../../../common/base-server';
import { InternalEventV2 } from '../../../types/events';

class TestServer extends BaseServer { 
  constructor() { 
    super({ serviceName: 'test-llm-bot' }); 
  }
  // Mock config
  getConfig(name?: string, options?: any): any {
    if (!name) return {} as any;
    if (name === 'PERSONALITY_ENABLED') return true as any;
    if (name === 'OPENAI_MODEL') return 'gpt-4o' as any;
    if (name === 'LLM_PLATFORM') return 'openai' as any;
    return options?.default;
  }
}

function baseEvt(): InternalEventV2 {
  return {
    v: '2',
    source: 'test',
    correlationId: 'corr-override',
    type: 'llm.request.v1',
    message: { id: 'm1', role: 'user', text: 'hello' },
    routingSlip: [{ id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.finalize.v1' }],
    annotations: [
      { id: 'a1', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'Say hi' },
      { 
        id: 'p1', 
        kind: 'personality', 
        source: 'test', 
        createdAt: new Date().toISOString(), 
        payload: { name: 'overrider' } 
      }
    ]
  } as any;
}

describe('llm-bot processor personality override', () => {
  test('overrides model and platform from personality', async () => {
    const server = new TestServer();
    const evt = baseEvt();
    
    // Mock personality fetch
    const deps = {
      fetchByName: async (name: string) => {
        if (name === 'overrider') {
          return {
            name: 'overrider',
            text: 'You are an overrider',
            status: 'active' as const,
            platform: 'ollama',
            model: 'llama3'
          };
        }
        return undefined;
      },
      callLLM: async (model: string) => `Response from ${model}`
    };

    let capturedModel = '';
    const status = await processEvent(server, evt, {
      ...deps,
      callLLM: async (model: string) => {
        capturedModel = model;
        return 'Override worked';
      }
    } as any);

    expect(status).toBe('OK');
    expect(capturedModel).toBe('llama3');
    // platformName is internal to processEvent but it affects which model factory is used.
    // In this test, we are mainly checking that the modelName was passed correctly to callLLM.
  });
});

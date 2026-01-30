import { processEvent } from '../processor';
import { BaseServer } from '../../../common/base-server';
import type { InternalEventV2 } from '../../../types/events';

class TestServer extends BaseServer { constructor() { super({ serviceName: 'test-llm-bot' }); } }

function baseEvt(): InternalEventV2 {
  return {
    v: '2',
    source: 'test',
    correlationId: 'c-unwrap',
    type: 'llm.request.v1',
    message: { id: 'm1', role: 'user', text: 'hello' },
    annotations: [
      { id: 'p1', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'Say hi' },
    ] as any,
    routingSlip: [{ id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.finalize.v1' }],
  } as any;
}

describe('llm-bot processor output unwrapping', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });
  afterAll(() => { process.env = OLD_ENV; });

  it('removes surrounding quotes from LLM output before creating candidate', async () => {
    process.env.PERSONALITY_ENABLED = 'false';
    process.env.USER_CONTEXT_ENABLED = 'false';
    const server = new TestServer();
    const evt = baseEvt();

    const status = await processEvent(server, evt, {
      callLLM: async () => '"Hello there"',
    });
    expect(status).toBe('OK');
    expect(Array.isArray(evt.candidates)).toBe(true);
    expect(evt.candidates!.length).toBeGreaterThan(0);
    expect(evt.candidates![0].text).toBe('Hello there');
  });
});

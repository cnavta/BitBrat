import { processEvent } from './processor';
import { BaseServer } from '../../common/base-server';
import type { InternalEventV2 } from '../../types/events';

// Mock OpenAI SDK to capture call arguments
const lastArgs: { body?: any; options?: any } = {};
jest.mock('openai', () => {
  const createMock = jest.fn(async (body: any, options?: any) => {
    (lastArgs as any).body = body;
    (lastArgs as any).options = options;
    return { output_text: 'Hello world' } as any;
  });
  class OpenAI {
    constructor(_cfg: any) {}
    public responses = { create: createMock } as any;
  }
  return { __esModule: true, default: OpenAI };
});

class TestServer extends BaseServer { constructor() { super({ serviceName: 'test-llm-bot' }); } }

function baseEvt(): InternalEventV2 {
  return {
    v: '1',
    source: 'test',
    correlationId: 'c-openai',
    type: 'llm.request.v1',
    message: { id: 'm1', role: 'user', text: 'hello' },
    routingSlip: [{ id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.finalize.v1' }],
    annotations: [
      { id: 'a1', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'Say hi' },
    ] as any,
  } as any;
}

describe('OpenAI Responses.create options usage', () => {
  beforeAll(() => {
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
    process.env.OPENAI_TIMEOUT_MS = '50'; // small for test; uses AbortSignal
  });

  test('passes AbortSignal via options and not in request body', async () => {
    const server = new TestServer();
    const evt = baseEvt();
    const status = await processEvent(server, evt);
    expect(status).toBe('OK');
    expect(Array.isArray(evt.candidates)).toBe(true);
    // ensure body does not contain signal
    expect(lastArgs.body).toBeDefined();
    expect(lastArgs.body.signal).toBeUndefined();
    // ensure options contains signal
    expect(lastArgs.options).toBeDefined();
    expect(lastArgs.options.signal).toBeDefined();
  });
});

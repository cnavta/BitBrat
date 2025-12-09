import { processEvent } from './processor';
import { BaseServer } from '../../common/base-server';
import type { InternalEventV2 } from '../../types/events';

class TestServer extends BaseServer { constructor() { super({ serviceName: 'test-llm-bot' }); } }

function baseEvt(): InternalEventV2 {
  return {
    v: '1',
    source: 'test',
    correlationId: 'c-mem',
    type: 'llm.request.v1',
    message: { id: 'm1', role: 'user', text: 'hello' },
    routingSlip: [{ id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.finalize.v1' }],
  } as any;
}

describe('llm-bot short-term memory', () => {
  const OLD = { MSGS: process.env.LLM_BOT_MEMORY_MAX_MESSAGES, CHARS: process.env.LLM_BOT_MEMORY_MAX_CHARS };

  afterEach(() => {
    if (OLD.MSGS === undefined) delete process.env.LLM_BOT_MEMORY_MAX_MESSAGES; else process.env.LLM_BOT_MEMORY_MAX_MESSAGES = OLD.MSGS;
    if (OLD.CHARS === undefined) delete process.env.LLM_BOT_MEMORY_MAX_CHARS; else process.env.LLM_BOT_MEMORY_MAX_CHARS = OLD.CHARS;
  });

  test('passes flattened conversation with multiple prompts and creates candidate', async () => {
    const server = new TestServer();
    const evt = baseEvt();
    const now = new Date();
    evt.annotations = [
      { id: 'a1', kind: 'prompt', source: 'test', createdAt: new Date(now.getTime() - 1000).toISOString(), value: 'First question' },
      { id: 'a2', kind: 'prompt', source: 'test', createdAt: now.toISOString(), value: 'Second question' },
    ] as any;

    let capturedInput = '';
    const status = await processEvent(server, evt, {
      callLLM: async (_model, input) => { capturedInput = input; return 'Assistant reply'; },
    });

    expect(status).toBe('OK');
    expect(capturedInput).toContain('(user) First question');
    expect(capturedInput).toContain('(user) Second question');
    expect(evt.candidates && evt.candidates[0]?.text).toBe('Assistant reply');
  });

  test('trims by char limit from oldest content', async () => {
    const server = new TestServer();
    const evt = baseEvt();
    const now = new Date();
    const long = 'A'.repeat(200);
    evt.annotations = [
      { id: 'a1', kind: 'prompt', source: 'test', createdAt: new Date(now.getTime() - 2000).toISOString(), value: long },
      { id: 'a2', kind: 'prompt', source: 'test', createdAt: new Date(now.getTime() - 1000).toISOString(), value: 'B' },
      { id: 'a3', kind: 'prompt', source: 'test', createdAt: now.toISOString(), value: 'C' },
    ] as any;

    process.env.LLM_BOT_MEMORY_MAX_CHARS = '10'; // small limit forces dropping long first message
    let inputSeen = '';
    const status = await processEvent(server, evt, {
      callLLM: async (_model, input) => { inputSeen = input; return 'ok'; },
    });
    expect(status).toBe('OK');
    expect(inputSeen).not.toContain(long); // long oldest dropped
    expect(inputSeen).toContain('(user) B');
    expect(inputSeen).toContain('(user) C');
  });

  test('trims by message count keeping last N', async () => {
    const server = new TestServer();
    const evt = baseEvt();
    const now = new Date();
    evt.annotations = [
      { id: 'a1', kind: 'prompt', source: 'test', createdAt: new Date(now.getTime() - 2000).toISOString(), value: 'one' },
      { id: 'a2', kind: 'prompt', source: 'test', createdAt: new Date(now.getTime() - 1000).toISOString(), value: 'two' },
      { id: 'a3', kind: 'prompt', source: 'test', createdAt: now.toISOString(), value: 'three' },
    ] as any;

    process.env.LLM_BOT_MEMORY_MAX_MESSAGES = '2';
    let inputSeen = '';
    const status = await processEvent(server, evt, {
      callLLM: async (_model, input) => { inputSeen = input; return 'ok'; },
    });
    expect(status).toBe('OK');
    expect(inputSeen).not.toContain('(user) one');
    expect(inputSeen).toContain('(user) two');
    expect(inputSeen).toContain('(user) three');
  });
});

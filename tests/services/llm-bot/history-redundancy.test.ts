import { processEvent } from '../../../src/services/llm-bot/processor';
import { getInstanceMemoryStore, __resetInstanceMemoryStoreForTests } from '../../../src/services/llm-bot/instance-memory';
import type { InternalEventV2 } from '../../../src/types/events';

function makeEvent(overrides: Partial<InternalEventV2> = {}): InternalEventV2 {
  return {
    v: '1',
    source: 'test',
    correlationId: 'corr-history-1',
    type: 'llm.request.v1',
    channel: '#general',
    user: { id: 'user-1', displayName: 'Alice' } as any,
    message: { id: 'm1', role: 'user', text: 'Current Message' } as any,
    annotations: [
        { id: 'p1', kind: 'prompt', value: 'Current Message' } as any
    ],
    ...overrides,
  } as any;
}

describe('llm-bot processor — conversation history redundancy', () => {
  class StubServer {
    public cfg: Record<string, any> = {};
    constructor() {
      this.cfg.LLM_BOT_SYSTEM_PROMPT = 'BASE-SYS';
      this.cfg.PERSONALITY_ENABLED = 'false';
      this.cfg.USER_CONTEXT_ENABLED = 'false';
      this.cfg.LLM_BOT_MEMORY_MAX_MESSAGES = 10;
      this.cfg.LLM_BOT_MEMORY_MAX_CHARS = 10000;
      this.cfg.CONVERSATION_STATE_RENDER_MODE = 'both';
    }
    getConfig<T>(key: string, opts?: { default?: any; required?: boolean; parser?: (v: any) => T }): T {
      const v = this.cfg[key];
      if (v !== undefined) return (opts?.parser ? opts.parser(v) : v) as T;
      if (opts && 'default' in (opts as any)) return (opts.parser ? opts.parser(opts.default) : opts.default) as T;
      if (opts?.required) throw new Error(`Missing config: ${key}`);
      return undefined as any;
    }
    getLogger() {
      return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
    }
  }

  beforeEach(() => {
    __resetInstanceMemoryStoreForTests();
  });

  test('excludes current message from conversation history transcript', async () => {
    const server = new StubServer() as any;
    const evt = makeEvent();

    // Seed prior memory
    const store = getInstanceMemoryStore(server);
    await store.append('#general:user-1', [
      { role: 'user', content: 'Old Question', createdAt: new Date(Date.now() - 10000).toISOString() },
      { role: 'assistant', content: 'Old Answer', createdAt: new Date(Date.now() - 5000).toISOString() },
    ]);

    let capturedInput = '';
    const deps = {
      callLLM: async (_model: string, prompt: string) => {
        capturedInput = prompt;
        return 'OK';
      },
    } as any;

    await processEvent(server, evt, deps);

    // The Input section should contain "Current Message"
    expect(capturedInput).toContain('## [Input]');
    expect(capturedInput).toContain('Current Message');

    // The History section should NOT contain "Current Message"
    // We look for the transcript part (U: ...)
    const historySection = capturedInput.slice(capturedInput.indexOf('## [Conversation State / History]'));
    
    // It should contain the old messages
    expect(historySection).toContain('U: Old Question');
    expect(historySection).toContain('A: Old Answer');

    // It should NOT contain the current message
    expect(historySection).not.toContain('U: Current Message');
    
    // The summary should also reflect only 2 exchanges
    expect(historySection).toContain('Recent exchanges: 2');
  });
});

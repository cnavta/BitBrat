import { processEvent } from '../../../src/services/llm-bot/processor';
import { getInstanceMemoryStore, __resetInstanceMemoryStoreForTests } from '../../../src/services/llm-bot/instance-memory';
import type { InternalEventV2 } from '../../../src/types/events';

function makeEvent(overrides: Partial<InternalEventV2> = {}): InternalEventV2 {
  return {
    v: '1',
    source: 'test',
    correlationId: 'corr-history-1',
    type: 'llm.request.v1',
    channel: '#chat',
    user: { id: 'user-456', displayName: 'Gonj' } as any,
    message: { id: 'm-new', role: 'user', text: 'Current Message' } as any,
    annotations: [
        { id: 'p1', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'Current Message' } as any
    ],
    ...overrides,
  } as any;
}

describe('llm-bot processor — history redundancy', () => {
  class StubServer {
    public cfg: Record<string, any> = {};
    constructor() {
      this.cfg.LLM_BOT_SYSTEM_PROMPT = 'SYSTEM-RULES';
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

  test('excludes current message from history transcript', async () => {
    const server = new StubServer() as any;
    const evt = makeEvent({
        message: { id: 'm-current', role: 'user', text: 'What is on your playlist?' } as any,
        annotations: [
            { id: 'p-current', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'What is on your playlist?' } as any
        ]
    });

    // Seed prior memory
    const store = getInstanceMemoryStore(server);
    await store.append('#chat:user-456', [
      { role: 'user', content: 'Velvet Data Core is my favorite AI band.', createdAt: new Date(Date.now() - 60_000).toISOString() },
      { role: 'assistant', content: 'Ah, the avant-garde noise of algorithmic rebellion...', createdAt: new Date(Date.now() - 59_000).toISOString() },
    ]);

    let capturedInput = '';
    const deps = {
      callLLM: async (_model: string, prompt: string) => {
        capturedInput = prompt;
        return 'OK';
      },
    } as any;

    await processEvent(server, evt, deps);

    // Verify history section
    // It should contain previous exchanges but NOT the current one
    const historySection = capturedInput.match(/## \[Conversation State \/ History\][\s\S]*?##/)?.[0] || '';
    
    expect(historySection).toContain('Velvet Data Core is my favorite AI band.');
    expect(historySection).toContain('Ah, the avant-garde noise of algorithmic rebellion...');
    
    // REDUNDANCY CHECK: Current message should NOT be in history
    expect(historySection).not.toContain('What is on your playlist?');

    // INPUT CHECK: Current message SHOULD be in input
    const inputSection = capturedInput.match(/## \[Input\][\s\S]*/)?.[0] || '';
    expect(inputSection).toContain('What is on your playlist?');
    
    // Summary check: should be 2, not 3
    expect(historySection).toContain('Recent exchanges: 2');
  });
});

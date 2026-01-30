import { processEvent } from '../../../src/services/llm-bot/processor';
import { getInstanceMemoryStore, __resetInstanceMemoryStoreForTests } from '../../../src/services/llm-bot/instance-memory';
import type { InternalEventV2 } from '../../../src/types/events';

function makeEvent(overrides: Partial<InternalEventV2> = {}): InternalEventV2 {
  return {
    v: '2',
    source: 'test',
    correlationId: 'corr-mem-1',
    type: 'llm.request.v1',
    channel: '#general',
    user: { id: 'user-1', displayName: 'Alice' } as any,
    message: { id: 'm1', role: 'user', text: 'Hello there' } as any,
    annotations: [],
    ...overrides,
  } as any;
}

describe('llm-bot processor — personality applied even with prior memory', () => {
  class StubServer {
    public cfg: Record<string, any> = {};
    constructor() {
      this.cfg.LLM_BOT_SYSTEM_PROMPT = 'BASE-SYS';
      this.cfg.PERSONALITY_ENABLED = 'true';
      this.cfg.PERSONALITY_MAX_ANNOTATIONS = 3;
      this.cfg.PERSONALITY_MAX_CHARS = 4000;
      this.cfg.PERSONALITY_CACHE_TTL_MS = 60_000;
      this.cfg.PERSONALITY_COMPOSE_MODE = 'append';
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

  test('prepends system with personality text when memory exists', async () => {
    const server = new StubServer() as any;
    const evt = makeEvent({
      annotations: [
        { id: 'p1', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'Do the thing' } as any,
        // Provide inline personality text to avoid Firestore dependency
        { id: 'pers1', kind: 'personality', source: 'test', createdAt: new Date().toISOString(), payload: { text: 'You are a friendly assistant.' } } as any,
      ],
    });

    // Seed prior memory for the same memKey (#general:user-1)
    const store = getInstanceMemoryStore(server);
    await store.append('#general:user-1', [
      { role: 'user', content: 'Prev Q', createdAt: new Date(Date.now() - 60_000).toISOString() },
      { role: 'assistant', content: 'Prev A', createdAt: new Date(Date.now() - 59_000).toISOString() },
    ]);

    // Capture the prompt text passed to callLLM (flattened messages)
    let capturedInput = '';
    const deps = {
      callLLM: async (_model: string, prompt: string) => {
        capturedInput = prompt;
        return 'OK';
      },
    } as any;

    const status = await processEvent(server, evt, deps);
    expect(status).toBe('OK');
    // Expect a system message present at the beginning and to include personality text
    // Extract the first message block which starts with (system) and ends before the next role marker
    const startIdx = capturedInput.indexOf('(system)');
    expect(startIdx).toBe(0);
    const nextRoleIdx = (() => {
      const u = capturedInput.indexOf('(user)', startIdx + 1);
      const a = capturedInput.indexOf('(assistant)', startIdx + 1);
      if (u === -1) return a;
      if (a === -1) return u;
      return Math.min(u, a);
    })();
    const systemBlock = nextRoleIdx >= 0 ? capturedInput.slice(0, nextRoleIdx) : capturedInput;
    expect(systemBlock).toContain('You are a friendly assistant.');
    // Ensure conversation state section is present
    expect(capturedInput).toContain('## [Conversation State / History]');
  });
});

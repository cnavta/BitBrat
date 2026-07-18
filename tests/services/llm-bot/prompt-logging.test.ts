import { processEvent } from '../../../src/services/llm-bot/processor';
import { isFeatureEnabled, features } from '../../../src/common/feature-flags';
import type { InternalEventV2 } from '../../../src/types/events';
import { getFirestore } from '../../../src/common/firebase';
import { redactText } from '../../../src/common/prompt-assembly/redaction';

jest.mock('../../../src/common/firebase', () => ({
  getFirestore: jest.fn(),
}));

jest.mock('../../../src/common/prompt-assembly/redaction', () => ({
  redactText: jest.fn((text) => text), // Default to no redaction for tests
}));

function makeEvent(overrides: Partial<InternalEventV2> = {}): InternalEventV2 {
  return {
    v: '2',
    source: 'test',
    correlationId: 'corr-log-1',
    type: 'llm.request.v1',
    channel: '#general',
    user: { id: 'user-1', displayName: 'Alice' } as any,
    message: { id: 'm1', role: 'user', text: 'Hello there' } as any,
    annotations: [
        { id: 'p1', kind: 'prompt', value: 'Hello prompt' } as any
    ],
    ...overrides,
  } as any;
}

describe('llm-bot processor — Prompt Logging', () => {
  let mockSet: jest.Mock;
  let mockDocumentStore: any;

  class StubServer {
    public cfg: Record<string, any> = {};
    private _documentStore: any;

    constructor(documentStore?: any) {
      this.cfg.OPENAI_MODEL = 'gpt-5-mini';
      this.cfg.PERSONALITY_ENABLED = 'false';
      this.cfg.USER_CONTEXT_ENABLED = 'false';
      this._documentStore = documentStore;
    }
    getConfig<T>(key: string, opts?: { default?: any; required?: boolean; parser?: (v: any) => T }): T {
      const v = this.cfg[key];
      if (v !== undefined) return (opts?.parser ? opts.parser(v) : v) as T;
      if (opts && 'default' in (opts as any)) return (opts.parser ? opts.parser(opts.default) : opts.default) as T;
      return undefined as any;
    }
    getLogger() {
      return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
    }
    // Sprint 344: Provide documentStore resource for prompt logging
    getResource(name: string): any {
      if (name === 'documentStore') return this._documentStore;
      return undefined;
    }
  }

  beforeEach(() => {
    jest.clearAllMocks();
    features.reset();

    // Sprint 344: Mock documentStore (PostgreSQL) instead of Firestore
    mockSet = jest.fn().mockResolvedValue(undefined);
    mockDocumentStore = {
      set: mockSet,
      get: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
    };
  });

  test('does NOT log to PostgreSQL when feature flag is disabled', async () => {
    features.setOverride('llm.promptLogging.enabled', 'false');
    const server = new StubServer(mockDocumentStore) as any;
    const evt = makeEvent();
    const deps = { callLLM: jest.fn().mockResolvedValue('LLM Response') };

    await processEvent(server, evt, deps);

    expect(mockSet).not.toHaveBeenCalled();
  });

  test('logs to PostgreSQL when feature flag is enabled', async () => {
    features.setOverride('llm.promptLogging.enabled', 'true');
    const server = new StubServer(mockDocumentStore) as any;
    const evt = makeEvent({ correlationId: 'corr-123' });
    const deps = { callLLM: jest.fn().mockResolvedValue('LLM Response') };

    await processEvent(server, evt, deps);

    expect(mockSet).toHaveBeenCalled();
    const [tableName, _id, logData] = mockSet.mock.calls[0];
    expect(tableName).toBe('prompt_logs');
    expect(logData).toMatchObject({
      correlationId: 'corr-123',
      model: 'gpt-5-mini',
      response: 'LLM Response',
      // ContextPacks contributing to prompt generation are listed for debugging/analysis (sprint-328).
      contextPacks: expect.any(Array),
    });
    // Check prompt content (contains (system) and (user) markers)
    expect(logData.prompt).toContain('(system)');
    expect(logData.prompt).toContain('(user)');
    expect(logData.prompt).toContain('Hello prompt');
  });

  test('applies redaction to prompt and response before logging', async () => {
    features.setOverride('llm.promptLogging.enabled', 'true');
    (redactText as jest.Mock).mockImplementation((text) => `REDACTED: ${text}`);

    const server = new StubServer(mockDocumentStore) as any;
    const evt = makeEvent();
    const deps = { callLLM: jest.fn().mockResolvedValue('Secret Response') };

    await processEvent(server, evt, deps);

    const [_tableName, _id, logData] = mockSet.mock.calls[0];
    expect(logData.prompt).toMatch(/^REDACTED:/);
    expect(logData.response).toBe('REDACTED: Secret Response');
  });

  test('fail-soft: continues execution even if PostgreSQL write fails', async () => {
    features.setOverride('llm.promptLogging.enabled', 'true');
    const server = new StubServer(mockDocumentStore) as any;
    const logger = server.getLogger();
    server.getLogger = () => logger;

    mockSet.mockRejectedValue(new Error('Firestore Down'));

    const evt = makeEvent();
    const deps = { callLLM: jest.fn().mockResolvedValue('LLM Response') };

    const status = await processEvent(server, evt, deps);

    expect(status).toBe('OK');
    // Wait a bit for the fire-and-forget promise to settle
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(logger.warn).toHaveBeenCalledWith('llm_bot.prompt_logging_failed', expect.objectContaining({
        error: 'Firestore Down'
    }));
  });
});

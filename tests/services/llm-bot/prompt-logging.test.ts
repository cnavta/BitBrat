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
    v: '1',
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
  let mockAdd: jest.Mock;
  let mockCollection: jest.Mock;
  let mockDb: any;

  class StubServer {
    public cfg: Record<string, any> = {};
    constructor() {
      this.cfg.OPENAI_MODEL = 'gpt-5-mini';
      this.cfg.PERSONALITY_ENABLED = 'false';
      this.cfg.USER_CONTEXT_ENABLED = 'false';
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
  }

  beforeEach(() => {
    jest.clearAllMocks();
    features.reset();
    
    mockAdd = jest.fn().mockResolvedValue({ id: 'doc-123' });
    mockCollection = jest.fn().mockReturnValue({ add: mockAdd });
    mockDb = { collection: mockCollection };
    (getFirestore as jest.Mock).mockReturnValue(mockDb);
  });

  test('does NOT log to Firestore when feature flag is disabled', async () => {
    features.setOverride('llm.promptLogging.enabled', 'false');
    const server = new StubServer() as any;
    const evt = makeEvent();
    const deps = { callLLM: jest.fn().mockResolvedValue('LLM Response') };

    await processEvent(server, evt, deps);

    expect(mockCollection).not.toHaveBeenCalled();
  });

  test('logs to Firestore when feature flag is enabled', async () => {
    features.setOverride('llm.promptLogging.enabled', 'true');
    const server = new StubServer() as any;
    const evt = makeEvent({ correlationId: 'corr-123' });
    const deps = { callLLM: jest.fn().mockResolvedValue('LLM Response') };

    await processEvent(server, evt, deps);

    expect(mockCollection).toHaveBeenCalledWith('prompt_logs');
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      correlationId: 'corr-123',
      model: 'gpt-5-mini',
      response: 'LLM Response',
      createdAt: expect.any(Date),
    }));
    // Check prompt content (contains (system) and (user) markers)
    const callArgs = mockAdd.mock.calls[0][0];
    expect(callArgs.prompt).toContain('(system)');
    expect(callArgs.prompt).toContain('(user)');
    expect(callArgs.prompt).toContain('Hello prompt');
  });

  test('applies redaction to prompt and response before logging', async () => {
    features.setOverride('llm.promptLogging.enabled', 'true');
    (redactText as jest.Mock).mockImplementation((text) => `REDACTED: ${text}`);
    
    const server = new StubServer() as any;
    const evt = makeEvent();
    const deps = { callLLM: jest.fn().mockResolvedValue('Secret Response') };

    await processEvent(server, evt, deps);

    const callArgs = mockAdd.mock.calls[0][0];
    expect(callArgs.prompt).toMatch(/^REDACTED:/);
    expect(callArgs.response).toBe('REDACTED: Secret Response');
  });

  test('fail-soft: continues execution even if Firestore write fails', async () => {
    features.setOverride('llm.promptLogging.enabled', 'true');
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const server = {
        getConfig: (key: string, opts?: any) => {
            if (key === 'OPENAI_MODEL') return 'gpt-5-mini';
            return undefined;
        },
        getLogger: () => logger
    } as any;
    
    mockAdd.mockRejectedValue(new Error('Firestore Down'));
    
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

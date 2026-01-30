import {
  extractPrompt,
  markCurrentStepError,
  computeIdempotency,
  appendAssistantCandidate,
} from '../src/apps/llm-bot-service';
import { processEvent } from '../src/services/llm-bot/processor';
import { __resetInstanceMemoryStoreForTests } from '../src/services/llm-bot/instance-memory';
import type { InternalEventV2, RoutingStep } from '../src/types/events';

// Mock AI SDK and providers to avoid network I/O
jest.mock('ai', () => ({
  generateText: jest.fn(),
  stepCountIs: jest.fn(),
  openai: jest.fn(),
}));

jest.mock('../src/common/firebase', () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn(() => ({
      add: jest.fn().mockResolvedValue({ id: 'doc-123' }),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ docs: [] }),
    })),
  })),
}));

function makeEvent(overrides: Partial<InternalEventV2> = {}): InternalEventV2 {
  const slip: RoutingStep[] = [
    { id: 'router', status: 'OK', nextTopic: 'internal.llmbot.v1', attempt: 0 },
    { id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.finalize.v1', attempt: 0 },
  ];
  return {
    v: '2',
    source: 'test',
    correlationId: 'corr-1',
    type: 'llm.request.v1',
    routingSlip: slip,
    message: { id: 'm1', role: 'user' },
    ...overrides,
  } as any;
}

describe('llm-bot-service helpers', () => {
  beforeAll(() => {
    process.env.MESSAGE_BUS_DRIVER = 'noop';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'gpt-5-mini';
  });

  test('extractPrompt from annotations array and legacy', () => {
    const evt1 = makeEvent({ annotations: [{ id: 'a1', kind: 'prompt', source: 't', createdAt: new Date().toISOString(), value: ' Hello ' }] as any });
    expect(extractPrompt(evt1)).toBe('Hello');

    const evt2: any = makeEvent({ annotations: { prompt: ' World ' } as any });
    expect(extractPrompt(evt2)).toBe('World');

    const evt3 = makeEvent({});
    expect(extractPrompt(evt3)).toBeNull();
  });

  test('markCurrentStepError sets ERROR on first pending step', () => {
    const evt = makeEvent({});
    const out = markCurrentStepError(evt, 'NO_PROMPT', 'x');
    const step = out.routingSlip?.[1]!;
    expect(step.status).toBe('ERROR');
    expect(step.error?.code).toBe('NO_PROMPT');
  });

  test('computeIdempotency + appendAssistantCandidate idempotent behavior', () => {
    const evt: any = makeEvent({});
    const key = computeIdempotency('p', evt.correlationId);
    // first append
    appendAssistantCandidate(evt, 'hi', 'gpt-5-mini');
    const firstLen = (evt.candidates || []).length;
    expect(firstLen).toBe(1);
    // mimic idempotency flag set in step attributes
    const step = (evt.routingSlip as RoutingStep[])[1];
    step.attributes = { ...(step.attributes || {}), llm_hash: key };
    appendAssistantCandidate(evt, 'hi', 'gpt-5-mini');
    expect((evt.candidates || []).length).toBe(firstLen + 1); // function itself does not enforce idempotency flag
  });
});

describe('handleLlmEvent flow', () => {
  class StubServer {
    public next = jest.fn(async (evt: InternalEventV2, status?: any) => {
      // Mimic BaseServer.next behavior of updating step status
      const slip = (evt.routingSlip as any[]) || [];
      const step = slip.find((s) => s.status === 'PENDING' || s.status === 'ERROR' || s.status === 'OK' || s.status === 'SKIP');
      // In a real server, it finds the FIRST step that is NOT terminal.
      // For this test, let's just find the llm-bot step.
      const botStep = slip.find((s) => s.id === 'llm-bot');
      if (botStep) {
        botStep.status = status;
        if (status === 'ERROR' && evt.errors && evt.errors.length > 0) {
          botStep.error = { code: 'UNKNOWN', message: evt.errors[0].message };
        }
      }
    });
    public getLogger() {
      return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;
    }
    public getConfig(key: string, opts?: any) {
      if (key === 'OPENAI_MODEL') return 'gpt-5-mini';
      return opts?.default;
    }
  }

  beforeEach(() => {
    __resetInstanceMemoryStoreForTests();
  });

  async function handleLlmEvent(server: any, evt: InternalEventV2, deps?: any) {
    const status = await processEvent(server, evt, deps);
    await server.next(evt, status);
  }

  test('missing prompt: sets SKIP and calls next()', async () => {
    const server = new StubServer() as any;
    const evt = makeEvent({ annotations: [] as any });
    await handleLlmEvent(server, evt);
    expect(server.next).toHaveBeenCalledTimes(1);
    expect(server.next.mock.calls[0][1]).toBe('SKIP');
    const step = evt.routingSlip?.[1]!;
    expect(step.status).toBe('SKIP');
  });

  test('present prompt: appends candidate and calls next()', async () => {
    const server = new StubServer() as any;
    const evt = makeEvent({ annotations: [{ id: 'a1', kind: 'prompt', source: 't', createdAt: new Date().toISOString(), value: 'Hi' }] as any });
    const deps = {
      callLLM: async (_model: string, _input: string) => {
        return 'Echo:Hi';
      }
    };
    await handleLlmEvent(server, evt, deps);
    expect(server.next).toHaveBeenCalledTimes(1);
    expect(server.next.mock.calls[0][1]).toBe('OK');
    expect((evt.candidates || []).length).toBeGreaterThan(0);
    expect(evt.candidates?.[0].text).toBe('Echo:Hi');
  });

  test('agent error: marks ERROR and advances', async () => {
    const server = new StubServer() as any;
    const evt = makeEvent({ annotations: [{ id: 'a1', kind: 'prompt', source: 't', createdAt: new Date().toISOString(), value: 'Hi' }] as any });
    const deps = {
      callLLM: async () => { throw new Error('AI Down'); }
    };
    await handleLlmEvent(server, evt, deps);
    expect(server.next).toHaveBeenCalledTimes(1);
    expect(server.next.mock.calls[0][1]).toBe('ERROR');
    const step = (evt.routingSlip as RoutingStep[])[1];
    expect(step.status).toBe('ERROR');
    // No candidate should be appended on failure
    expect(Array.isArray((evt as any).candidates) ? (evt as any).candidates.length : 0).toBe(0);
  });
});

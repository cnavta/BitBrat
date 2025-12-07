import {
  extractPrompt,
  markCurrentStepError,
  computeIdempotency,
  appendAssistantCandidate,
  handleLlmEvent,
  __resetAgentForTests,
} from '../src/apps/llm-bot-service';
import type { InternalEventV2, RoutingStep } from '../src/types/events';

// Mock the optional MCP agent to avoid network I/O
jest.mock(
  '@joshuacalpuerto/mcp-agent',
  () => {
    return {
      Agent: {
        initialize: async (_cfg: any) => ({
          prompt: async ({ user }: any) => ({ text: `Echo:${user}` }),
        }),
      },
    };
  },
  { virtual: true }
);

function makeEvent(overrides: Partial<InternalEventV2> = {}): InternalEventV2 {
  const slip: RoutingStep[] = [
    { id: 'router', status: 'OK', nextTopic: 'internal.llmbot.v1', attempt: 0 },
    { id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.finalize.v1', attempt: 0 },
  ];
  return {
    v: '1',
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
    public next = jest.fn(async (_evt: InternalEventV2, _status?: any) => {});
    public getLogger() {
      return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;
    }
  }

  beforeEach(() => {
    __resetAgentForTests();
  });

  test('missing prompt: sets ERROR and calls next()', async () => {
    const server = new StubServer() as any;
    const evt = makeEvent({ annotations: [] as any });
    await handleLlmEvent(server, evt);
    expect(server.next).toHaveBeenCalledTimes(1);
    expect(server.next.mock.calls[0][1]).toBe('ERROR');
    const step = evt.routingSlip?.[1]!;
    expect(step.status).toBe('ERROR');
    expect(step.error?.code).toBe('NO_PROMPT');
  });

  test('present prompt: appends candidate and calls next()', async () => {
    const server = new StubServer() as any;
    const evt = makeEvent({ annotations: [{ id: 'a1', kind: 'prompt', source: 't', createdAt: new Date().toISOString(), value: 'Hi' }] as any });
    await handleLlmEvent(server, evt);
    expect(server.next).toHaveBeenCalledTimes(1);
    expect(server.next.mock.calls[0][1]).toBe('OK');
    expect((evt.candidates || []).length).toBeGreaterThan(0);
    expect(evt.candidates?.[0].text).toContain('Echo:Hi');
  });

  test('agent unavailable: marks ERROR LLM_AGENT_UNAVAILABLE and advances', async () => {
    const server = new StubServer() as any;
    const prevKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY; // force getAgent() to throw
    try {
      const evt = makeEvent({ annotations: [{ id: 'a1', kind: 'prompt', source: 't', createdAt: new Date().toISOString(), value: 'Hi' }] as any });
      await handleLlmEvent(server, evt);
      expect(server.next).toHaveBeenCalledTimes(1);
      expect(server.next.mock.calls[0][1]).toBe('ERROR');
      const step = (evt.routingSlip as RoutingStep[])[1];
      expect(step.status).toBe('ERROR');
      expect(step.error?.code).toBe('LLM_AGENT_UNAVAILABLE');
      // No candidate should be appended on agent init failure
      expect(Array.isArray((evt as any).candidates) ? (evt as any).candidates.length : 0).toBe(0);
    } finally {
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prevKey;
    }
  });
});

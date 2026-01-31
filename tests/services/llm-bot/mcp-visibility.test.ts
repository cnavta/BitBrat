import { processEvent } from '../../../src/services/llm-bot/processor';
import { features } from '../../../src/common/feature-flags';
import { getFirestore } from '../../../src/common/firebase';
import { generateText } from 'ai';

jest.mock('../../../src/common/firebase', () => ({
  getFirestore: jest.fn(),
}));

jest.mock('ai', () => ({
  generateText: jest.fn(),
  stepCountIs: jest.fn(),
}));

jest.mock('@ai-sdk/openai', () => ({
  openai: jest.fn(),
}));

function makeEvent(overrides: any = {}): any {
  return {
    v: '2',
    correlationId: 'corr-mcp-1',
    annotations: [
      { id: 'p1', kind: 'prompt', value: 'Hello' },
      { id: 'pers1', kind: 'personality', payload: { name: 'Bratty' } }
    ],
    ...overrides,
  };
}

describe('llm-bot processor — MCP Visibility', () => {
  let mockAdd: jest.Mock;
  let mockCollection: jest.Mock;
  let mockDb: any;

  class StubServer {
    public cfg: Record<string, any> = {
      OPENAI_MODEL: 'gpt-4o',
      PERSONALITY_ENABLED: 'true',
      USER_CONTEXT_ENABLED: 'false',
    };
    getConfig<T>(key: string, opts?: any): T {
      const v = this.cfg[key];
      if (v !== undefined) return (opts?.parser ? opts.parser(v) : v) as T;
      return opts?.default;
    }
    getLogger() {
      return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
    }
  }

  beforeEach(() => {
    jest.clearAllMocks();
    features.setOverride('llm.promptLogging.enabled', 'true');
    
    mockAdd = jest.fn().mockResolvedValue({ id: 'doc-123' });
    mockCollection = jest.fn().mockReturnValue({ 
        add: mockAdd,
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: [{ data: () => ({ name: 'Bratty', text: 'You are bratty.', status: 'active' }) }] })
    });
    mockDb = { collection: mockCollection };
    (getFirestore as jest.Mock).mockReturnValue(mockDb);
  });

  test('logs personality names and tool calls to prompt_logs', async () => {
    const server = new StubServer() as any;
    const evt = makeEvent();
    
    (generateText as jest.Mock).mockResolvedValue({
      text: 'Final response',
      toolCalls: [
        { toolCallId: 'tc1', toolName: 'mcp:get_weather', args: { city: 'Berlin' } }
      ],
      toolResults: [
        { toolCallId: 'tc1', toolName: 'mcp:get_weather', args: { city: 'Berlin' }, result: 'Sunny, 25°C' }
      ]
    });

    await processEvent(server, evt, { registry: { getTools: () => ({}) } as any });

    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      personalityNames: ['Bratty'],
      toolCalls: [
        expect.objectContaining({
          tool: 'mcp:get_weather',
          args: { city: 'Berlin' },
          result: 'Sunny, 25°C'
        })
      ]
    }));
  });

  test('captures tool errors in prompt_logs', async () => {
    const server = new StubServer() as any;
    const evt = makeEvent();
    
    (generateText as jest.Mock).mockResolvedValue({
      text: 'Error occurred',
      toolCalls: [
        { toolCallId: 'tc2', toolName: 'mcp:faulty_tool', args: {} }
      ],
      toolResults: [
        { toolCallId: 'tc2', toolName: 'mcp:faulty_tool', args: {}, error: 'Tool failed intentionally' }
      ]
    });

    await processEvent(server, evt, { registry: { getTools: () => ({}) } as any });

    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      toolCalls: [
        expect.objectContaining({
          tool: 'mcp:faulty_tool',
          error: 'Tool failed intentionally'
        })
      ]
    }));
  });
});

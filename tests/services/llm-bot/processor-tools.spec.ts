import { processEvent } from '../../../src/services/llm-bot/processor';
import { BaseServer } from '../../../src/common/base-server';
import { InternalEventV2 } from '../../../src/types/events';
import { generateText } from 'ai';
import { getInstanceMemoryStore } from '../../../src/services/llm-bot/instance-memory';
import { resolvePersonalityParts } from '../../../src/services/llm-bot/personality-resolver';
import { z } from 'zod';

jest.mock('ai', () => ({
  generateText: jest.fn(),
  stepCountIs: jest.fn(),
  openai: jest.fn(),
}));

jest.mock('../../../src/services/llm-bot/instance-memory');
jest.mock('../../../src/services/llm-bot/personality-resolver');
jest.mock('../../../src/common/firebase', () => ({
  getFirestore: jest.fn(),
}));

describe('Processor Tools', () => {
  let mockServer: any;
  let mockStore: any;
  let mockRegistry: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStore = {
      read: jest.fn().mockResolvedValue([]),
      append: jest.fn().mockResolvedValue(undefined),
    };
    (getInstanceMemoryStore as jest.Mock).mockReturnValue(mockStore);

    mockServer = {
      getConfig: jest.fn((key, { default: def } = {}) => def),
      getLogger: jest.fn().mockReturnValue({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
    };

    (resolvePersonalityParts as jest.Mock).mockResolvedValue([]);
    (generateText as jest.Mock).mockResolvedValue({
      text: 'Mocked response',
    });

    mockRegistry = {
      getTools: jest.fn(),
    };
  });

  it('should pass tools to generateText with correct parameters mapping', async () => {
    const mockTool = {
      id: 'mcp:test-tool',
      source: 'mcp' as const,
      description: 'A test tool',
      inputSchema: z.object({ arg1: z.string() }),
      execute: jest.fn(),
    };

    mockRegistry.getTools.mockReturnValue({
      'mcp_test_tool': mockTool
    });

    const evt: InternalEventV2 = {
      correlationId: 'corr-1',
      type: 'internal.llmbot.v1' as any,
      v: '2',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'test',
      },
      identity: {
        external: { id: 'u1', platform: 'test' },
        user: { id: 'u1', roles: ['admin'] }
      },
      annotations: [
        { id: 'a1', kind: 'prompt', value: 'Use the tool', createdAt: new Date().toISOString(), source: 'test' }
      ],
      routingSlip: [],
      egress: { destination: 'test' },
    };

    await processEvent(mockServer as BaseServer, evt, { registry: mockRegistry });

    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
      tools: expect.objectContaining({
        mcp_test_tool: expect.objectContaining({
          description: 'A test tool',
          inputSchema: mockTool.inputSchema,
        })
      })
    }));
  });
});

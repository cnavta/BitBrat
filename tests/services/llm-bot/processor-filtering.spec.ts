import { processEvent } from '../../../src/services/llm-bot/processor';
import { BaseServer } from '../../../src/common/base-server';
import { InternalEventV2 } from '../../../src/types/events';
import { generateText } from 'ai';
import { getInstanceMemoryStore } from '../../../src/services/llm-bot/instance-memory';
import { resolvePersonalityParts } from '../../../src/services/llm-bot/personality-resolver';

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
jest.mock('../../../src/common/llm/provider-factory', () => ({
    getLlmProvider: jest.fn().mockReturnValue({}),
}));

describe('Processor Tool Filtering', () => {
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
        getTools: jest.fn().mockReturnValue({
            'global_tool': { id: 'global_tool', description: 'Global', inputSchema: {} },
            'story_tool': { id: 'story_tool', description: 'Story Only', inputSchema: {}, scopes: ['story'] },
            'other_tool': { id: 'other_tool', description: 'Other Only', inputSchema: {}, scopes: ['other'] },
        }),
    };
  });

  it('should only include global tools and story tools when scope is story', async () => {
    const evt: InternalEventV2 = {
      correlationId: 'corr-1',
      type: 'internal.llmbot.v1',
      v: '2',
      ingress: { connector: 'system', ingressAt: new Date().toISOString(), source: 'test' },
      identity: { external: { id: 'u1', platform: 'test' } },
      metadata: { scope: 'story' },
      annotations: [
        { id: 'a1', kind: 'prompt', value: 'Use a tool', createdAt: new Date().toISOString(), source: 'test' }
      ],
      routing: { stage: 'analysis', slip: [], history: [] },
      egress: { connector: 'system', destination: 'test' },
    };

    await processEvent(mockServer as BaseServer, evt, { registry: mockRegistry });

    const toolsPassedToAI = (generateText as jest.Mock).mock.calls[0][0].tools;
    expect(toolsPassedToAI).toHaveProperty('global_tool');
    expect(toolsPassedToAI).toHaveProperty('story_tool');
    expect(toolsPassedToAI).not.toHaveProperty('other_tool');
  });

  it('should include all tools when no scope is requested', async () => {
    const evt: InternalEventV2 = {
      correlationId: 'corr-1',
      type: 'internal.llmbot.v1',
      v: '2',
      ingress: { connector: 'system', ingressAt: new Date().toISOString(), source: 'test' },
      identity: { external: { id: 'u1', platform: 'test' } },
      annotations: [
        { id: 'a1', kind: 'prompt', value: 'Use a tool', createdAt: new Date().toISOString(), source: 'test' }
      ],
      routing: { stage: 'analysis', slip: [], history: [] },
      egress: { connector: 'system', destination: 'test' },
    };

    await processEvent(mockServer as BaseServer, evt, { registry: mockRegistry });

    const toolsPassedToAI = (generateText as jest.Mock).mock.calls[0][0].tools;
    expect(toolsPassedToAI).toHaveProperty('global_tool');
    expect(toolsPassedToAI).toHaveProperty('story_tool');
    expect(toolsPassedToAI).toHaveProperty('other_tool');
  });
});

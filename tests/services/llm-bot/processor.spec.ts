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

describe('Processor', () => {
  let mockServer: any;
  let mockStore: any;

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
  });

  it('should process an event and generate a response', async () => {
    const evt: InternalEventV2 = {
      correlationId: 'corr-1',
      type: 'internal.llmbot.v1',
      v: '2',
      ingress: {
        connector: 'system',
        ingressAt: new Date().toISOString(),
        source: 'test',
        channel: 'test',
      },
      identity: {
        external: { id: 'u1', platform: 'test' }
      },
      annotations: [
        { id: 'a1', kind: 'prompt', value: 'Hello', createdAt: new Date().toISOString(), source: 'test' }
      ],
      routing: { stage: 'analysis', slip: [], history: [] },
      egress: { connector: 'system', destination: 'test' },
    };

    const result = await processEvent(mockServer as BaseServer, evt);

    expect(result).toBe('OK');
    expect(generateText).toHaveBeenCalled();
    expect(evt.candidates).toHaveLength(1);
    expect(evt.candidates![0].text).toBe('Mocked response');
  });

  it('should skip if no prompt is found', async () => {
    const evt: InternalEventV2 = {
      correlationId: 'corr-1',
      type: 'internal.llmbot.v1',
      v: '2',
      ingress: {
        connector: 'system',
        ingressAt: new Date().toISOString(),
        source: 'test',
      },
      identity: {
        external: { id: 'u1', platform: 'test' }
      },
      annotations: [],
      routing: { stage: 'analysis', slip: [], history: [] },
      egress: { connector: 'system', destination: 'test' },
    };

    const result = await processEvent(mockServer as BaseServer, evt);

    expect(result).toBe('SKIP');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('should place requesting user info in the Requesting User section instead of the Task section', async () => {
    const evt: InternalEventV2 = {
      correlationId: 'corr-user-context',
      type: 'internal.llmbot.v1',
      v: '2',
      ingress: {
        connector: 'system',
        ingressAt: new Date().toISOString(),
        source: 'test',
        channel: 'test',
      },
      identity: {
        external: { id: 'u1', platform: 'twitch', displayName: 'Gonj_The_Unjust' },
        user: { id: 'u1', displayName: 'Gonj_The_Unjust' } as any,
      },
      message: {
        id: 'm-user-context',
        role: 'user',
        text: '@bitbrat_the_ai The void, it calls.',
        rawPlatformPayload: { username: 'Gonj_The_Unjust' },
      } as any,
      annotations: [
        {
          id: 'a1',
          kind: 'prompt',
          value: 'Respond to the user input constructively.',
          createdAt: new Date().toISOString(),
          source: 'test',
        } as any,
      ],
      routing: { stage: 'analysis', slip: [], history: [] },
      egress: { connector: 'system', destination: 'test' },
    };

    const callLLM = jest.fn().mockResolvedValue('Mocked response');

    const result = await processEvent(mockServer as BaseServer, evt, { callLLM });

    expect(result).toBe('OK');
    expect(callLLM).toHaveBeenCalledTimes(1);

    const prompt = callLLM.mock.calls[0][1] as string;
    expect(prompt).toContain('## [Requesting User]');
    expect(prompt).toContain('- Handle: Gonj_The_Unjust');
    expect(prompt).not.toContain('## [Requesting User]\n- None provided.');
    expect(prompt).not.toContain('## [Task]\n- (3) Respond to the user input constructively.\n\nUsername: Gonj_The_Unjust');
  });

  it('should handle errors gracefully', async () => {
    (generateText as jest.Mock).mockRejectedValue(new Error('AI error'));

    const evt: InternalEventV2 = {
      correlationId: 'corr-1',
      type: 'internal.llmbot.v1',
      v: '2',
      ingress: {
        connector: 'system',
        ingressAt: new Date().toISOString(),
        source: 'test',
      },
      identity: {
        external: { id: 'u1', platform: 'test' }
      },
      annotations: [
        { id: 'a1', kind: 'prompt', value: 'Hello', createdAt: new Date().toISOString(), source: 'test' }
      ],
      routing: { stage: 'analysis', slip: [], history: [] },
      egress: { connector: 'system', destination: 'test' },
    };

    const result = await processEvent(mockServer as BaseServer, evt);

    expect(result).toBe('ERROR');
    expect(evt.errors).toHaveLength(1);
    expect(evt.errors![0].message).toBe('AI error');
  });
});

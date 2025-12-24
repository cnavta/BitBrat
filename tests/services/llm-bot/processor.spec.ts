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
      source: 'test',
      v: '1',
      annotations: [
        { id: 'a1', kind: 'prompt', value: 'Hello', createdAt: new Date().toISOString(), source: 'test' }
      ],
      routingSlip: [],
      channel: 'test',
      user: { id: 'u1' },
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
      source: 'test',
      v: '1',
      annotations: [],
      routingSlip: [],
    };

    const result = await processEvent(mockServer as BaseServer, evt);

    expect(result).toBe('SKIP');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('should handle errors gracefully', async () => {
    (generateText as jest.Mock).mockRejectedValue(new Error('AI error'));

    const evt: InternalEventV2 = {
      correlationId: 'corr-1',
      type: 'internal.llmbot.v1',
      source: 'test',
      v: '1',
      annotations: [
        { id: 'a1', kind: 'prompt', value: 'Hello', createdAt: new Date().toISOString(), source: 'test' }
      ],
      routingSlip: [],
    };

    const result = await processEvent(mockServer as BaseServer, evt);

    expect(result).toBe('ERROR');
    expect(evt.errors).toHaveLength(1);
    expect(evt.errors![0].message).toBe('AI error');
  });
});

import { analyzeWithLlm, SYSTEM_PROMPT } from '../../../src/services/query-analyzer/llm-provider';
import { getLlmProvider } from '../../../src/common/llm/provider-factory';
import * as ai from 'ai';
import { getFirestore } from '../../../src/common/firebase';
import { features } from '../../../src/common/feature-flags';

jest.mock('ai', () => ({
  generateObject: jest.fn(),
}));

jest.mock('ai-sdk-ollama', () => ({
  createOllama: jest.fn(() => jest.fn(() => ({}))),
}));

jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: jest.fn(() => jest.fn(() => ({}))),
}));

jest.mock('../../../src/common/firebase', () => ({
  getFirestore: jest.fn(),
}));

describe('llm-provider', () => {
  let mockAdd: jest.Mock;
  let mockCollection: jest.Mock;
  let mockDb: any;

  beforeEach(() => {
    jest.clearAllMocks();
    features.setOverride('llm.promptLogging.enabled', 'true');

    mockAdd = jest.fn().mockResolvedValue({ id: 'doc-123' });
    const mockCollectionInner = jest.fn().mockReturnValue({ add: mockAdd });
    const mockDoc = jest.fn().mockReturnValue({ collection: mockCollectionInner });
    mockCollection = jest.fn().mockImplementation((name) => {
      if (name === 'services') return { doc: mockDoc };
      return { add: mockAdd };
    });
    mockDb = { collection: mockCollection };
    (getFirestore as jest.Mock).mockReturnValue(mockDb);
  });

  it('should call generateObject with correct parameters for ollama and log full prompt', async () => {
    const mockObject = {
      intent: 'question',
      tone: { valence: 0.5, arousal: 0.5 },
      risk: { level: 'none', type: 'none' },
    };
    (ai.generateObject as jest.Mock).mockResolvedValue({ object: mockObject, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } });

    const result = await analyzeWithLlm('hello', { providerName: 'ollama', modelName: 'llama3', correlationId: 'test-corr' });

    expect(ai.generateObject).toHaveBeenCalledWith(expect.objectContaining({
      model: expect.anything(),
      prompt: 'hello',
      system: SYSTEM_PROMPT,
      schema: expect.anything(),
    }));
    expect(result).toEqual(mockObject);

    // Verify logging
    expect(mockCollection).toHaveBeenCalledWith('services');
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      correlationId: 'test-corr',
      prompt: `System: ${SYSTEM_PROMPT}\n\nUser: hello`,
      model: 'llama3',
    }));
  });

  it('should include processingTimeMs in prompt logs', async () => {
    const mockObject = {
      intent: 'question',
      tone: { valence: 0.5, arousal: 0.5 },
      risk: { level: 'none', type: 'none' },
    };
    (ai.generateObject as jest.Mock).mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      return { object: mockObject };
    });

    await analyzeWithLlm('hello', { correlationId: 'test-time-corr' });

    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      processingTimeMs: expect.any(Number),
    }));
    const logData = mockAdd.mock.calls.find(call => call[0].correlationId === 'test-time-corr')[0];
    expect(logData.processingTimeMs).toBeGreaterThanOrEqual(50);
  });

  it('should call generateObject with correct parameters for openai', async () => {
    const mockObject = {
      intent: 'joke',
      tone: { valence: 0.8, arousal: 0.2 },
      risk: { level: 'none', type: 'none' },
    };
    (ai.generateObject as jest.Mock).mockResolvedValue({ object: mockObject });

    const result = await analyzeWithLlm('why did the chicken cross the road?', { providerName: 'openai', modelName: 'gpt-4o-mini' });

    expect(ai.generateObject).toHaveBeenCalledWith(expect.objectContaining({
      model: expect.anything(),
      prompt: 'why did the chicken cross the road?',
    }));
    expect(result).toEqual(mockObject);
  });

  it('should return null and log error when generateObject fails', async () => {
    const mockLogger = { error: jest.fn(), info: jest.fn() };
    (ai.generateObject as jest.Mock).mockRejectedValue(new Error('AI error'));

    const result = await analyzeWithLlm('error', { logger: mockLogger });

    expect(result).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledWith('query-analyzer.llm_provider_error', expect.objectContaining({
      error: 'AI error'
    }));
  });

  it('should throw error for unsupported provider in getLlmProvider', () => {
    expect(() => getLlmProvider({ provider: 'unsupported', model: 'model' })).toThrow('Unsupported LLM provider: unsupported');
  });
});

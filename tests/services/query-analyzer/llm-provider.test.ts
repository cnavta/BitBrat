import { analyzeWithLlm, getLlmProvider } from '../../../src/services/query-analyzer/llm-provider';
import * as ai from 'ai';

jest.mock('ai', () => ({
  generateObject: jest.fn(),
}));

jest.mock('ai-sdk-ollama', () => ({
  ollama: jest.fn(() => ({})),
}));

jest.mock('@ai-sdk/openai', () => ({
  openai: jest.fn(() => ({})),
}));

describe('llm-provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call generateObject with correct parameters for ollama', async () => {
    const mockObject = {
      intent: 'question',
      tone: { valence: 0.5, arousal: 0.5 },
      risk: { level: 'none', type: 'none' },
    };
    (ai.generateObject as jest.Mock).mockResolvedValue({ object: mockObject });

    const result = await analyzeWithLlm('hello', { providerName: 'ollama', modelName: 'llama3' });

    expect(ai.generateObject).toHaveBeenCalledWith(expect.objectContaining({
      model: expect.anything(),
      prompt: 'hello',
      system: expect.any(String),
      schema: expect.anything(),
    }));
    expect(result).toEqual(mockObject);
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
    const mockLogger = { error: jest.fn() };
    (ai.generateObject as jest.Mock).mockRejectedValue(new Error('AI error'));

    const result = await analyzeWithLlm('error', { logger: mockLogger });

    expect(result).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledWith('query-analyzer.llm_provider_error', expect.objectContaining({
      error: 'AI error'
    }));
  });

  it('should throw error for unsupported provider in getLlmProvider', () => {
    expect(() => getLlmProvider('unsupported', 'model')).toThrow('Unsupported LLM provider: unsupported');
  });
});

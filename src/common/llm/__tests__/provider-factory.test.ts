import { getLlmProvider } from '../provider-factory';
import { createOpenAI } from '@ai-sdk/openai';
import { createOllama } from 'ai-sdk-ollama';

jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: jest.fn().mockReturnValue(jest.fn().mockReturnValue({ modelId: 'openai-model' })),
}));

jest.mock('ai-sdk-ollama', () => ({
  createOllama: jest.fn().mockReturnValue(jest.fn().mockReturnValue({ modelId: 'ollama-model' })),
}));

describe('provider-factory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should instantiate OpenAI provider', () => {
    const config = {
      provider: 'openai',
      model: 'gpt-4',
      apiKey: 'test-key',
    };
    const provider = getLlmProvider(config);
    expect(createOpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'test-key' }));
    expect(provider).toBeDefined();
  });

  it('should handle "n/a" or empty string as undefined baseURL', () => {
    const config = {
      provider: 'openai',
      model: 'gpt-4',
      baseURL: 'n/a',
    };
    getLlmProvider(config);
    expect(createOpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: undefined }));

    jest.clearAllMocks();
    getLlmProvider({ ...config, baseURL: '' });
    expect(createOpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: undefined }));
  });

  it('should instantiate vLLM provider as OpenAI-compatible', () => {
    const config = {
      provider: 'vllm',
      model: 'llama3',
      baseURL: 'http://vllm:8000/v1',
    };
    const provider = getLlmProvider(config);
    expect(createOpenAI).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'http://vllm:8000/v1',
      apiKey: 'vllm-not-required',
    }));
    expect(provider).toBeDefined();
  });

  it('should use default vLLM baseURL if not provided', () => {
    const config = {
      provider: 'vllm',
      model: 'llama3',
    };
    getLlmProvider(config);
    expect(createOpenAI).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'http://localhost:8000/v1',
    }));
  });

  it('should instantiate Ollama provider', () => {
    const config = {
      provider: 'ollama',
      model: 'llama3',
      baseURL: 'http://ollama:11434',
    };
    const provider = getLlmProvider(config);
    expect(createOllama).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'http://ollama:11434/api',
    }));
    expect(provider).toBeDefined();
  });

  it('should throw error for unsupported provider', () => {
    const config = {
      provider: 'anthropic',
      model: 'claude-3',
    };
    expect(() => getLlmProvider(config)).toThrow('Unsupported LLM provider: anthropic');
  });
});

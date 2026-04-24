import { getLlmProvider } from '../provider-factory';
import { createOpenAI } from '@ai-sdk/openai';
import { createOllama } from 'ai-sdk-ollama';

jest.mock('@ai-sdk/openai', () => {
  const mockProvider = jest.fn().mockReturnValue({ modelId: 'openai-model' });
  (mockProvider as any).embedding = jest.fn().mockReturnValue({ modelId: 'openai-embedding-model' });
  (mockProvider as any).image = jest.fn().mockReturnValue({ modelId: 'openai-image-model' });
  return {
    createOpenAI: jest.fn().mockReturnValue(mockProvider),
  };
});

jest.mock('ai-sdk-ollama', () => {
  const mockProvider = jest.fn().mockReturnValue({ modelId: 'ollama-model' });
  (mockProvider as any).embedding = jest.fn().mockReturnValue({ modelId: 'ollama-embedding-model' });
  return {
    createOllama: jest.fn().mockReturnValue(mockProvider),
  };
});

describe('provider-factory', () => {
  let mockOpenAIProviderInstance: any;
  let mockOllamaProviderInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOpenAIProviderInstance = (createOpenAI as jest.Mock)();
    mockOllamaProviderInstance = (createOllama as jest.Mock)();
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

  it('should instantiate embedding model for OpenAI', () => {
    const config = {
      provider: 'openai',
      model: 'text-embedding-3-small',
      kind: 'embedding' as const,
    };
    const provider = getLlmProvider(config);
    expect((mockOpenAIProviderInstance as any).embedding).toHaveBeenCalledWith('text-embedding-3-small');
    expect(provider).toEqual({ modelId: 'openai-embedding-model' });
  });

  it('should instantiate embedding model for vLLM', () => {
    const config = {
      provider: 'vllm',
      model: 'llama3',
      kind: 'embedding' as const,
    };
    const provider = getLlmProvider(config);
    expect((mockOpenAIProviderInstance as any).embedding).toHaveBeenCalledWith('llama3');
    expect(provider).toEqual({ modelId: 'openai-embedding-model' });
  });

  it('should instantiate embedding model for Ollama', () => {
    const config = {
      provider: 'ollama',
      model: 'llama3',
      kind: 'embedding' as const,
    };
    const provider = getLlmProvider(config);
    expect((mockOllamaProviderInstance as any).embedding).toHaveBeenCalledWith('llama3');
    expect(provider).toEqual({ modelId: 'ollama-embedding-model' });
  });

  it('should throw error for unsupported provider', () => {
    const config = {
      provider: 'anthropic',
      model: 'claude-3',
    };
    expect(() => getLlmProvider(config)).toThrow('Unsupported LLM provider: anthropic');
  });
});

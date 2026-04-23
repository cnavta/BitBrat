import { createOpenAI } from '@ai-sdk/openai';
import { createOllama } from 'ai-sdk-ollama';

/**
 * Configuration for the LLM provider.
 */
export interface LlmProviderConfig {
  provider: string;
  model: string;
  baseURL?: string;
  apiKey?: string;
  kind?: 'language' | 'embedding';
}

/**
 * Returns an LLM provider instance based on the provided configuration.
 * Centralizes the instantiation logic for OpenAI, Ollama, and vLLM (OpenAI-compatible).
 */
export function getLlmProvider(config: LlmProviderConfig) {
  const { provider, model, apiKey, kind = 'language' } = config;
  const baseURL = config.baseURL === 'n/a' || config.baseURL === '' ? undefined : config.baseURL;

  switch (provider.toLowerCase()) {
    case 'openai': {
      const providerInstance = createOpenAI({ baseURL, apiKey });
      if (model.startsWith('dall-e')) {
        return providerInstance.image(model) as any;
      }
      if (kind === 'embedding') {
        return providerInstance.embedding(model);
      }
      return providerInstance(model);
    }
    case 'vllm': {
      // vLLM is OpenAI-compatible. Default baseURL if not provided.
      const providerInstance = createOpenAI({
        baseURL: baseURL || 'http://localhost:8000/v1',
        apiKey: apiKey || 'vllm-not-required',
      });
      if (kind === 'embedding') {
        return providerInstance.embedding(model);
      }
      return providerInstance(model);
    }
    case 'ollama': {
      const providerInstance = createOllama({
        baseURL: baseURL ? `${baseURL}/api` : undefined,
      });
      if (kind === 'embedding') {
        return providerInstance.embedding(model);
      }
      return providerInstance(model);
    }
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}

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
}

/**
 * Returns an LLM provider instance based on the provided configuration.
 * Centralizes the instantiation logic for OpenAI, Ollama, and vLLM (OpenAI-compatible).
 */
export function getLlmProvider(config: LlmProviderConfig) {
  const { provider, model, baseURL, apiKey } = config;

  switch (provider.toLowerCase()) {
    case 'openai':
      return createOpenAI({ baseURL, apiKey })(model);
    case 'vllm':
      // vLLM is OpenAI-compatible. Default baseURL if not provided.
      return createOpenAI({
        baseURL: baseURL || 'http://localhost:8000/v1',
        apiKey: apiKey || 'vllm-not-required',
      })(model);
    case 'ollama':
      return createOllama({
        baseURL: baseURL ? `${baseURL}/api` : undefined,
      })(model);
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}

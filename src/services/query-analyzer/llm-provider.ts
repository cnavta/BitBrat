import { generateObject, LanguageModel } from 'ai';
import { ollama } from 'ai-sdk-ollama';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

/**
 * Zod schema for query analysis, matching the specification in the TA.
 */
export const queryAnalysisSchema = z.object({
  intent: z.enum(['question', 'joke', 'praise', 'critique', 'command', 'meta', 'spam']),
  tone: z.object({
    valence: z.number().min(-1).max(1),
    arousal: z.number().min(-1).max(1),
  }),
  risk: z.object({
    level: z.enum(['none', 'low', 'med', 'high']),
    type: z.enum(['none', 'harassment', 'spam', 'privacy', 'self_harm', 'sexual', 'illegal']),
  }),
});

export type QueryAnalysis = z.infer<typeof queryAnalysisSchema>;

/**
 * Factory to get the appropriate LLM provider.
 */
export function getLlmProvider(providerName: string, modelName: string): any {
  switch (providerName.toLowerCase()) {
    case 'ollama':
      return ollama(modelName);
    case 'openai':
      return openai(modelName);
    default:
      throw new Error(`Unsupported LLM provider: ${providerName}`);
  }
}

export const SYSTEM_PROMPT = `You are an expert linguistic analyzer for the BitBrat Platform. 
Analyze the user message and return a JSON object with intent, tone, and risk levels.
Valence: -1 (hostile) to 1 (supportive).
Arousal: -1 (calm) to 1 (fired up).`;

/**
 * High-level analysis function using Vercel AI SDK generateObject.
 */
export async function analyzeWithLlm(
  text: string,
  options: {
    providerName?: string;
    modelName?: string;
    logger?: { error: (msg: string, meta?: any) => void };
  } = {}
): Promise<QueryAnalysis | null> {
  const providerName = options.providerName || process.env.LLM_PROVIDER || 'ollama';
  const modelName = options.modelName || process.env.LLM_MODEL || (providerName === 'openai' ? 'gpt-4o-mini' : 'llama3');
  
  try {
    const provider = getLlmProvider(providerName, modelName);
    const { object } = await (generateObject as any)({
      model: provider,
      schema: queryAnalysisSchema,
      prompt: text,
      system: SYSTEM_PROMPT,
    });
    return object;
  } catch (error: any) {
    if (options.logger) {
      options.logger.error('query-analyzer.llm_provider_error', { 
        error: error.message, 
        providerName, 
        modelName 
      });
    } else {
      console.error('LLM Analysis Error:', error);
    }
    return null;
  }
}

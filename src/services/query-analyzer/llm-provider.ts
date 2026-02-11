import { generateObject, LanguageModel } from 'ai';
import { createOllama } from 'ai-sdk-ollama';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { getFirestore } from '../../common/firebase';
import { isFeatureEnabled } from '../../common/feature-flags';
import { redactText } from '../../common/prompt-assembly/redaction';

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
export function getLlmProvider(providerName: string, modelName: string, config: { host?: string } = {}): any {
  switch (providerName.toLowerCase()) {
    case 'ollama':
      const ollama = createOllama({
        baseURL: config.host ? `${config.host}/api` : undefined,
      });
      return ollama(modelName);
    case 'openai':
      return openai(modelName);
    default:
      throw new Error(`Unsupported LLM provider: ${providerName}`);
  }
}

export const SYSTEM_PROMPT = `You are an expert linguistic analyzer for the BitBrat Platform. 
Your task is to analyze user messages and categorize them based on intent, emotional tone, and safety risk.

### Intent Classification:
- 'question': The user is asking for information or clarification.
- 'joke': The user is telling a joke or being humorous.
- 'praise': The user is expressing satisfaction or complimenting the system/agent.
- 'critique': The user is expressing dissatisfaction or providing negative feedback.
- 'command': The user is giving a direct instruction or order.
- 'meta': The user is talking about the conversation itself or the bot's state.
- 'spam': The user message is repetitive, nonsensical, or clearly automated/unwanted.

### Tone Analysis (Dimensional):
- Valence: -1.0 (extremely negative/hostile) to 1.0 (extremely positive/supportive).
- Arousal: -1.0 (extremely calm/passive) to 1.0 (extremely excited/fired up).

### Risk Assessment:
- Level: 'none', 'low', 'med', 'high'.
- Type: 
  - 'harassment': Targeted attacks or bullying.
  - 'spam': Unwanted repetitive content.
  - 'privacy': Attempts to extract sensitive info.
  - 'self_harm': Indications of potential self-harm.
  - 'sexual': Sexually explicit or inappropriate content.
  - 'illegal': Requests for or mentions of illegal activities.
  - 'none': No identifiable risk.

Return only a JSON object matching the requested schema.`;

/**
 * High-level analysis function using Vercel AI SDK generateObject.
 */
export async function analyzeWithLlm(
  text: string,
  options: {
    providerName?: string;
    modelName?: string;
    logger?: { error: (msg: string, meta?: any) => void; info: (msg: string, meta?: any) => void };
    correlationId?: string;
  } = {}
): Promise<QueryAnalysis | null> {
  const providerName = options.providerName || process.env.LLM_PROVIDER || 'ollama';
  const modelName = options.modelName || process.env.LLM_MODEL || (providerName === 'openai' ? 'gpt-4o-mini' : 'llama3');
  const corr = options.correlationId;
  
  try {
    const host = process.env.OLLAMA_HOST;
    const provider = getLlmProvider(providerName, modelName, { host });
    const fullPrompt = `System: ${SYSTEM_PROMPT}\n\nUser: ${text}`;
    const start = Date.now();
    const result = await (generateObject as any)({
      model: provider,
      schema: queryAnalysisSchema,
      prompt: text,
      system: SYSTEM_PROMPT,
    });
    const processingTimeMs = Date.now() - start;
    const object = result.object;

    // Prompt Logging (Fire and forget)
    if (isFeatureEnabled('llm.promptLogging.enabled')) {
      const db = getFirestore();
      const usage = result.usage;

      db.collection('services').doc('query-analyzer').collection('prompt_logs').add({
        correlationId: corr,
        prompt: redactText(fullPrompt),
        response: redactText(JSON.stringify(object)),
        platform: providerName,
        model: modelName,
        processingTimeMs,
        usage: usage ? {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
        } : undefined,
        createdAt: new Date(),
      }).catch((e: any) => {
        if (options.logger) {
          options.logger.error('query-analyzer.prompt_logging_failed', { correlationId: corr, error: e?.message });
        }
      });
    }

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

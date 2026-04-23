import { generateObject, embed } from 'ai';
import { z } from 'zod';
import { getFirestore } from '../../common/firebase';
import { isFeatureEnabled } from '../../common/feature-flags';
import { redactText } from '../../common/prompt-assembly/redaction';
import { getLlmProvider } from '../../common/llm/provider-factory';

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
  entities: z.array(z.object({
    text: z.string(),
    type: z.string(),
  })),
  topic: z.string(),
});

export type QueryAnalysis = z.infer<typeof queryAnalysisSchema>;


export const SYSTEM_PROMPT = `You are an expert linguistic analyzer for the BitBrat Platform. 
Your task is to analyze user messages and categorize them based on intent, emotional tone, safety risk, entities, and topic.

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

### Entity Extraction:
- Identify key entities in the message: people, places, organizations, products, dates, etc.
- Return an array of objects with 'text' and 'type'.

### Topic Classification:
- Provide a concise one-to-three word label for the primary topic of the message (e.g., 'technical support', 'billing', 'greeting', 'weather').

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
    tokenCount?: number;
  } = {}
): Promise<QueryAnalysis | null> {
  const providerName = options.providerName || process.env.LLM_PROVIDER || 'ollama';
  const modelName = options.modelName || process.env.LLM_MODEL || (providerName === 'openai' ? 'gpt-4o-mini' : 'llama3');
  const corr = options.correlationId;
  
  try {
    const provider = getLlmProvider({
      provider: providerName,
      model: modelName,
      baseURL: process.env.LLM_BASE_URL,
      apiKey: process.env.LLM_API_KEY,
    });
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
        entities: object.entities,
        topic: object.topic,
        platform: providerName,
        model: modelName,
        processingTimeMs,
        usage: usage ? {
          promptTokens: options.tokenCount ?? usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: (options.tokenCount ?? usage.promptTokens) + (usage.completionTokens ?? 0),
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

/**
 * Generate semantic embedding for the given text.
 */
export async function generateEmbedding(
  text: string,
  options: {
    providerName?: string;
    modelName?: string;
    logger?: { error: (msg: string, meta?: any) => void; info: (msg: string, meta?: any) => void };
    correlationId?: string;
  } = {}
): Promise<number[] | null> {
  const providerName = options.providerName || process.env.LLM_PROVIDER || 'ollama';
  const modelName = options.modelName || process.env.EMBEDDING_MODEL || (providerName === 'openai' ? 'text-embedding-3-small' : 'llama3');
  const corr = options.correlationId;

  try {
    const provider = getLlmProvider({
      provider: providerName,
      model: modelName,
      baseURL: process.env.LLM_BASE_URL,
      apiKey: process.env.LLM_API_KEY,
      kind: 'embedding',
    });

    const result = await embed({
      model: provider as any,
      value: text,
    });

    return result.embedding;
  } catch (error: any) {
    if (options.logger) {
      options.logger.error('query-analyzer.embedding_error', {
        error: error.message,
        providerName,
        modelName,
        correlationId: corr
      });
    }
    return null;
  }
}

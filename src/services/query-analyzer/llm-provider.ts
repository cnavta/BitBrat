import { generateObject, embed } from 'ai';
import { z } from 'zod';
import { getFirestore } from '../../common/firebase';
import { isFeatureEnabled } from '../../common/feature-flags';
import { redactText } from '../../common/prompt-assembly/redaction';
import { getLlmProvider } from '../../common/llm/provider-factory';
import type { Firestore } from 'firebase-admin/firestore';
import type { IDocumentStore } from '../../common/persistence/interfaces';

// =============================================================================
// Prompt Log Store Abstraction
// =============================================================================

/**
 * Prompt log record structure for query-analyzer.
 */
export interface PromptLogRecord {
  correlationId?: string;
  prompt: string;
  response: string;
  serviceName?: string; // Sprint 344: Service discriminator for PostgreSQL (implicit in Firestore path)
  entities?: Array<{ text: string; type: string }>; // Optional - query-analyzer specific
  topic?: string; // Optional - query-analyzer specific
  platform: string;
  model: string;
  processingTimeMs: number;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  createdAt: Date | string;
  // Additional fields for llm-bot
  behaviorProfile?: any;
  personalityNames?: string[];
  contextPacks?: Array<{ id: string; title?: string }>;
  toolCalls?: Array<{ tool: string; args: string; result: string; error?: string }>;
  // Allow any additional fields for extensibility
  [key: string]: any;
}

/**
 * Interface for prompt log storage operations.
 * Supports both Firestore and PostgreSQL via IDocumentStore.
 */
export interface IPromptLogStore {
  /**
   * Record a prompt log entry (fire-and-forget).
   * @param record - Prompt log record
   */
  log(record: PromptLogRecord): Promise<void>;
}

/**
 * Firestore-based prompt log store implementation.
 */
export class FirestorePromptLogStore implements IPromptLogStore {
  constructor(
    private readonly firestore: Firestore,
    private readonly serviceName: string = 'query-analyzer'
  ) {}

  async log(record: PromptLogRecord): Promise<void> {
    await this.firestore
      .collection('services')
      .doc(this.serviceName)
      .collection('prompt_logs')
      .add(record);
  }
}

/**
 * PostgreSQL-based prompt log store implementation via IDocumentStore.
 * Sprint 344: Includes serviceName discriminator for multi-service logging.
 */
export class DocumentStorePromptLogStore implements IPromptLogStore {
  constructor(
    private readonly store: IDocumentStore,
    private readonly serviceName: string,
    private readonly tableName: string = 'prompt_logs'
  ) {}

  async log(record: PromptLogRecord): Promise<void> {
    const id = `${this.serviceName}_${record.platform}_${record.model}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await this.store.set(this.tableName, id, {
      ...record,
      serviceName: this.serviceName, // Sprint 344: Add service discriminator
      createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt,
    });
  }
}

/**
 * Factory function to create prompt log store based on backend detection.
 *
 * Sprint 344: Updated to support serviceName discriminator for PostgreSQL.
 *
 * @param dbOrStore - Optional Firestore instance or IDocumentStore
 * @param serviceName - Service name (used for both Firestore path and PostgreSQL discriminator)
 * @param tableName - Table name for PostgreSQL (default: 'prompt_logs')
 * @returns IPromptLogStore implementation
 *
 * @example
 * // Firestore backend
 * const store = createPromptLogStore(firestore, 'llm-bot');
 *
 * // PostgreSQL backend
 * const store = createPromptLogStore(documentStore, 'llm-bot', 'prompt_logs');
 */
export function createPromptLogStore(
  dbOrStore?: any,
  serviceName?: string,
  tableName?: string
): IPromptLogStore {
  const defaultServiceName = serviceName || 'query-analyzer';
  const defaultTableName = tableName || 'prompt_logs';

  // Check if Firestore instance (has collection() method)
  if (dbOrStore && typeof dbOrStore.collection === 'function') {
    return new FirestorePromptLogStore(dbOrStore, defaultServiceName);
  }

  // Check if IDocumentStore instance
  if (dbOrStore && typeof dbOrStore.get === 'function' && typeof dbOrStore.set === 'function') {
    return new DocumentStorePromptLogStore(dbOrStore, defaultServiceName, defaultTableName);
  }

  // Auto-select based on PERSISTENCE_DRIVER environment variable
  const driver = process.env.PERSISTENCE_DRIVER;
  if (driver === 'postgres' || driver === 'postgresql') {
    throw new Error(
      'createPromptLogStore: PostgreSQL driver selected but no IDocumentStore instance provided'
    );
  }

  // Fallback to Firestore (legacy, deprecated - default is PostgreSQL via factory.ts)
  return new FirestorePromptLogStore(getFirestore(), defaultServiceName);
}

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
    documentStore?: any; // IDocumentStore or Firestore instance for prompt logging
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
      const usage = result.usage;
      const promptLogStore = createPromptLogStore(options.documentStore, 'query-analyzer', 'prompt_logs');

      const logRecord: PromptLogRecord = {
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
      };

      promptLogStore.log(logRecord).catch((e: any) => {
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

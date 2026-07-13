// Embedding generation utilities for context packs (P4 RAG Scale-Out, sprint-338, BL-338-202)
//
// Provides embedText() helper for generating OpenAI embeddings with caching to avoid redundant
// API calls on heartbeat re-registrations. Shared between VectorContextProvider (query embedding)
// and tool-gateway (pack registration embedding).

interface EmbeddingCacheEntry {
  embedding: number[];
  expiresAt: number;
}

interface EmbedTextOptions {
  /** OpenAI embedding model (default: text-embedding-ada-002) */
  model?: string;
  /** API timeout in milliseconds (default: 5000) */
  timeout?: number;
  /** Enable caching (default: true) */
  enableCache?: boolean;
  /** Cache TTL in milliseconds (default: 15 minutes) */
  cacheTtlMs?: number;
}

/** Global in-memory embedding cache (shared across VectorContextProvider and tool-gateway) */
const embeddingCache = new Map<string, EmbeddingCacheEntry>();

/**
 * Generate OpenAI embedding for the given text. Returns a 1536-dimension float array.
 * Caches embeddings by default (TTL: 15 minutes) to avoid redundant API calls.
 *
 * @param text - Text to embed (e.g., pack title + body preview)
 * @param options - Embedding options (model, timeout, cache settings)
 * @returns 1536-dimension embedding vector, or null on failure
 */
export async function embedText(
  text: string,
  options: EmbedTextOptions = {}
): Promise<number[] | null> {
  const enableCache = options.enableCache !== false;
  const cacheTtlMs = options.cacheTtlMs ?? 15 * 60 * 1000; // 15 minutes default

  // Check cache first (if enabled)
  if (enableCache) {
    const cached = embeddingCache.get(text);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.embedding;
    }
  }

  try {
    // Generate embedding via OpenAI API
    const embedding = await callOpenAIEmbedding(text, options);

    // Store in cache (if enabled)
    if (enableCache && embedding) {
      embeddingCache.set(text, {
        embedding,
        expiresAt: Date.now() + cacheTtlMs,
      });
    }

    return embedding;
  } catch (error: any) {
    // Return null on error (caller decides how to handle)
    console.error('embedText error:', error.message);
    return null;
  }
}

/**
 * Call OpenAI Embeddings API to generate embedding for text.
 * Throws on API failure (caught by embedText).
 */
async function callOpenAIEmbedding(
  text: string,
  options: EmbedTextOptions
): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable not set');
  }

  const model = options.model ?? 'text-embedding-ada-002';
  const timeout = options.timeout ?? 5000; // 5 seconds default (more generous than VectorContextProvider's 200ms)

  try {
    // Dynamic import to avoid bundling OpenAI SDK when not needed
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey, timeout });

    const response = await client.embeddings.create({
      model,
      input: text,
    });

    const embedding = response.data[0].embedding;

    // Validate dimensions (should be 1536 for text-embedding-ada-002)
    if (embedding.length !== 1536) {
      throw new Error(`Unexpected embedding dimensions: ${embedding.length} (expected 1536)`);
    }

    return embedding;
  } catch (error: any) {
    // Re-throw with enriched context
    const enrichedError = new Error(`OpenAI embedding API error: ${error.message}`);
    (enrichedError as any).originalError = error;
    throw enrichedError;
  }
}

/**
 * Build embeddingText from a context pack (title + body preview).
 * Format: `pack.title + '\n\n' + String(pack.body).slice(0, 500)`
 *
 * @param pack - Context pack to build embedding text from
 * @returns Text suitable for embedding generation
 */
export function buildEmbeddingText(pack: { title: string; body: any }): string {
  const bodyStr = typeof pack.body === 'string' ? pack.body : JSON.stringify(pack.body);
  return `${pack.title}\n\n${bodyStr.slice(0, 500)}`;
}

/**
 * Clear the embedding cache (useful for testing or memory management).
 */
export function clearEmbeddingCache(): void {
  embeddingCache.clear();
}

/**
 * Get cache statistics (for observability).
 */
export function getEmbeddingCacheStats(): { size: number } {
  return {
    size: embeddingCache.size,
  };
}

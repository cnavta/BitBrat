// Vector Context Provider — Firestore Vector Search-based pack retrieval (P4 RAG Scale-Out, sprint-338)
//
// A ContextProvider that retrieves packs via Firestore Vector Search based on semantic similarity to a
// query string. This is the P4 "RAG scale-out" path; it co-exists with StaticContextProvider (the
// deterministic floor). The provider does NOT support listBindings() — it is a retrieval-only source.

import type { ContextProvider, ContextPack, ContextBinding } from './types';
import { getFirestore } from '../firebase';
import type { Firestore } from 'firebase-admin/firestore';
import { logger } from '../logging';

export interface VectorContextProviderOptions {
  /** Maximum number of packs to retrieve per query (default: 5). */
  maxResults?: number;

  /** Minimum similarity score threshold (0-1, default: 0.7). Cosine similarity. */
  minSimilarity?: number;

  /** OpenAI embedding model (default: text-embedding-ada-002). */
  embeddingModel?: string;

  /** Enable embedding cache (TTL-based, default: true). */
  enableCache?: boolean;

  /** Cache TTL in milliseconds (default: 15 minutes). */
  cacheTtlMs?: number;

  /** Timeout for embedding + vector search (ms, default: 200). */
  timeout?: number;
}

interface CacheEntry {
  embedding: number[];
  expiresAt: number;
}

/**
 * A ContextProvider that retrieves packs via Firestore Vector Search based on semantic
 * similarity to a query. This is the P4 "RAG scale-out" path; it co-exists with
 * StaticContextProvider (the deterministic floor). The provider does NOT support
 * listBindings() — it is a retrieval-only source, not a binding source.
 */
export class VectorContextProvider implements ContextProvider {
  private db: Firestore;
  private embedCache = new Map<string, CacheEntry>();

  constructor(
    private query: string,  // The semantic query (user prompt or tool names)
    private options: VectorContextProviderOptions = {}
  ) {
    this.db = getFirestore();
  }

  /**
   * Retrieve context packs via vector similarity search. The query string is embedded
   * (cached if enabled), then a Firestore Vector Search query returns the top-N most
   * similar packs. Inactive packs are filtered out.
   */
  async listPacks(): Promise<ContextPack[]> {
    const maxResults = this.options.maxResults ?? 5;
    const minSimilarity = this.options.minSimilarity ?? 0.7;

    try {
      // Generate embedding (may fail, caught below as non-fatal)
      const embedding = await this.embedQuery(this.query);

      // Firestore Vector Search query
      // Note: findNearest is a Firestore Vector Search API (requires vector index on 'embedding' field)
      const vectorQuery = this.db
        .collection('context_packs')
        .where('active', '==', true)
        .findNearest('embedding', embedding, {
          limit: maxResults,
          distanceMeasure: 'COSINE',
        });

      const snapshot = await vectorQuery.get();
      const packs: ContextPack[] = [];

      // Log all candidates with their similarity scores for debugging
      const candidates = snapshot.docs.map(doc => {
        const data = doc.data() as any;
        const distance = data._distance ?? 1;
        const similarity = 1 - distance;
        return { id: data.id, similarity, distance };
      });

      if (candidates.length > 0) {
        logger.debug('context_pack.rag_candidates', {
          querySnippet: this.query.slice(0, 50),
          minSimilarity,
          candidates,
        });
      }

      for (const doc of snapshot.docs) {
        const data = doc.data() as any;

        // Firestore Vector Search returns distance (0 = identical, higher = less similar)
        // Convert to similarity: 1 - distance (1 = identical, 0 = orthogonal)
        const distance = data._distance ?? 1;
        const similarity = 1 - distance;

        if (similarity < minSimilarity) {
          logger.debug('context_pack.rag_filtered', {
            packId: data.id,
            similarity,
            minSimilarity,
            reason: 'below_threshold',
          });
          continue;  // Below threshold, skip
        }

        // Map Firestore doc to ContextPack (exclude Firestore internal fields)
        packs.push({
          id: data.id,
          version: data.version,
          title: data.title,
          priority: data.priority,
          format: data.format,
          body: data.body,
          source: data.source,
        });
      }

      return packs;
    } catch (error: any) {
      // Vector search failure is non-fatal (fall back to static bindings only)
      logger.warn('context_pack.rag_failed', {
        error: error.message,
        querySnippet: this.query.slice(0, 50),
      });
      return [];
    }
  }

  /**
   * Bindings are not supported by VectorContextProvider; the provider is retrieval-only.
   * Static bindings remain the source of deterministic tool-pack relationships.
   */
  listBindings(): ContextBinding[] {
    return [];
  }

  /**
   * Embed a query string via OpenAI API (text-embedding-ada-002), with caching.
   * Returns a 1536-dimension float array, or throws on failure.
   */
  private async embedQuery(text: string): Promise<number[]> {
    // Check cache first (if enabled)
    const enableCache = this.options.enableCache !== false;
    if (enableCache) {
      const cached = this.embedCache.get(text);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.embedding;
      }
    }

    try {
      // Embed via OpenAI API
      const embedding = await this.callOpenAIEmbedding(text);

      // Store in cache (if enabled)
      if (enableCache) {
        const cacheTtlMs = this.options.cacheTtlMs ?? 15 * 60 * 1000;  // 15 minutes default
        this.embedCache.set(text, {
          embedding,
          expiresAt: Date.now() + cacheTtlMs,
        });
      }

      return embedding;
    } catch (error: any) {
      // Re-throw to be caught by listPacks (which handles all errors non-fatally)
      throw error;
    }
  }

  /**
   * Call OpenAI Embeddings API to generate embedding for text.
   * Throws on API failure (caught by caller).
   */
  private async callOpenAIEmbedding(text: string): Promise<number[]> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable not set');
    }

    const model = this.options.embeddingModel ?? 'text-embedding-ada-002';
    const timeout = this.options.timeout ?? 200;

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
      // Enrich error with context
      const enrichedError = new Error(`OpenAI embedding API error: ${error.message}`);
      (enrichedError as any).originalError = error;
      throw enrichedError;
    }
  }

  /**
   * Clear the embedding cache (useful for testing or memory management).
   */
  public clearCache(): void {
    this.embedCache.clear();
  }

  /**
   * Get cache statistics (for observability).
   */
  public getCacheStats(): { size: number; hitRate?: number } {
    return {
      size: this.embedCache.size,
      // Hit rate tracking would require instrumenting get/set (deferred to future)
    };
  }
}

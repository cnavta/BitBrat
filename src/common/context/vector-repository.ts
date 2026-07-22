import type { Firestore } from 'firebase-admin/firestore';
import type { IDocumentStore, QueryFilter } from '../persistence/interfaces';
import type { Priority } from '../prompt-assembly/types';

// =============================================================================
// Vector Context Provider Repository Abstraction
// =============================================================================

export interface VectorSearchOptions {
  /** Collection/table name for context packs */
  collection: string;
  /** Embedding vector to search with */
  embedding: number[];
  /** Maximum number of results to return */
  limit: number;
  /** Distance measure (only COSINE supported) */
  distanceMeasure: 'COSINE';
}

export interface VectorSearchResult {
  id: string;
  version: string;
  title: string;
  priority?: Priority;
  format: 'markdown' | 'json';
  body: string | object;
  source: string;
  /** Distance from query vector (0 = identical, higher = less similar) */
  distance: number;
}

/**
 * Interface for vector similarity search operations.
 */
export interface IVectorStore {
  /**
   * Perform vector similarity search on context packs.
   * @param options - Search options including embedding vector and limit
   * @returns Array of matching packs with distance scores
   */
  vectorSearch(options: VectorSearchOptions): Promise<VectorSearchResult[]>;
}

/**
 * Firestore implementation of vector store using Firestore Vector Search.
 */
export class FirestoreVectorStore implements IVectorStore {
  constructor(private readonly firestore: Firestore) {}

  async vectorSearch(options: VectorSearchOptions): Promise<VectorSearchResult[]> {
    // Firestore Vector Search query
    // Note: findNearest is a Firestore Vector Search API (requires vector index on 'embedding' field)
    const vectorQuery = this.firestore
      .collection(options.collection)
      .where('active', '==', true)
      .findNearest('embedding', options.embedding, {
        limit: options.limit,
        distanceMeasure: options.distanceMeasure,
      });

    const snapshot = await vectorQuery.get();
    const results: VectorSearchResult[] = [];

    for (const doc of snapshot.docs) {
      const data = doc.data() as any;

      // Firestore Vector Search returns distance (0 = identical, higher = less similar)
      const distance = data._distance ?? 1;

      results.push({
        id: data.id,
        version: data.version,
        title: data.title,
        priority: data.priority,
        format: data.format,
        body: data.body,
        source: data.source,
        distance,
      });
    }

    return results;
  }
}

/**
 * PostgreSQL implementation of vector store using pgvector extension.
 */
export class DocumentStoreVectorStore implements IVectorStore {
  constructor(private readonly store: IDocumentStore) {}

  async vectorSearch(options: VectorSearchOptions): Promise<VectorSearchResult[]> {
    // PostgreSQL pgvector query using cosine distance operator (<=>)
    // The query should:
    // 1. Filter active=true packs
    // 2. Calculate cosine distance between query embedding and pack embeddings
    // 3. Order by distance ASC (smallest distance = most similar)
    // 4. Limit results
    //
    // Note: This requires raw SQL support in IDocumentStore or a specialized vector search method.
    // For now, we'll use a custom query format that the PostgreSQL adapter can interpret.

    const filters: QueryFilter[] = [
      { field: 'active', operator: '==', value: true }
    ];

    const vectorQuery = {
      filters,
      orderBy: {
        field: 'embedding',
        direction: 'asc' as const,
        vector: options.embedding,
        distanceMeasure: 'COSINE'
      },
      limit: options.limit,
    };

    const records = await this.store.query(options.collection, vectorQuery);

    return records.map((data: any) => ({
      id: data.id,
      version: data.version,
      title: data.title,
      priority: data.priority,
      format: data.format,
      body: data.body,
      source: data.source,
      // PostgreSQL pgvector calculates distance during query
      // Distance should be populated by the adapter
      distance: data._distance ?? 1,
    }));
  }
}

/**
 * Factory function to create vector store based on backend detection.
 */
export function createVectorStore(
  dbOrStore?: any
): IVectorStore {
  // Check if Firestore instance
  if (dbOrStore && typeof dbOrStore.collection === 'function') {
    return new FirestoreVectorStore(dbOrStore);
  }

  // Check if IDocumentStore instance
  if (dbOrStore && typeof dbOrStore.get === 'function' && typeof dbOrStore.set === 'function') {
    return new DocumentStoreVectorStore(dbOrStore);
  }

  // Auto-select based on PERSISTENCE_DRIVER environment variable
  const driver = process.env.PERSISTENCE_DRIVER;
  if (driver === 'postgres' || driver === 'postgresql') {
    throw new Error(
      'createVectorStore: PostgreSQL driver selected but no IDocumentStore instance provided'
    );
  }

  // Fallback to Firestore (legacy, deprecated - default is PostgreSQL via factory.ts)
  return new FirestoreVectorStore(undefined as any);
}

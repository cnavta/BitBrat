/**
 * Persistence Layer Interfaces
 *
 * Vendor-neutral abstractions for document and key-value storage.
 * Supports both Firestore and PostgreSQL backends via driver selection.
 */

/**
 * Query filter for document queries
 */
export interface QueryFilter {
  field: string;
  operator: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains' | 'array-contains-any';
  value: any;
}

/**
 * Query options for document retrieval
 */
export interface QueryOptions {
  filters?: QueryFilter[];
  orderBy?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
}

/**
 * Document store interface - vendor-neutral document persistence
 *
 * Implementations:
 * - FirestoreDocumentStore: Google Cloud Firestore backend
 * - PostgresDocumentStore: PostgreSQL with JSONB backend
 */
export interface IDocumentStore {
  /**
   * Get a single document by ID
   */
  get<T = any>(collection: string, id: string): Promise<T | null>;

  /**
   * Set (create or update) a document
   */
  set<T = any>(collection: string, id: string, data: T): Promise<void>;

  /**
   * Delete a document by ID
   */
  delete(collection: string, id: string): Promise<void>;

  /**
   * Query documents with filters, ordering, and pagination
   */
  query<T = any>(collection: string, options: QueryOptions): Promise<T[]>;

  /**
   * Get all documents in a collection (use with caution)
   */
  getAll<T = any>(collection: string): Promise<T[]>;

  /**
   * Watch for changes to a collection
   *
   * Implementation notes:
   * - Firestore: Uses onSnapshot for real-time updates
   * - PostgreSQL: Uses polling (default 5s interval)
   *
   * @returns Unsubscribe function to stop watching
   */
  watch<T = any>(
    collection: string,
    callback: (documents: T[]) => void,
    pollInterval?: number
  ): () => void;

  /**
   * Batch write operations (transactional if supported by backend)
   */
  batch(operations: BatchOperation[]): Promise<void>;

  /**
   * Check if the store is healthy and connected
   */
  health(): Promise<{ healthy: boolean; latency?: number; error?: string }>;
}

/**
 * Batch operation for atomic writes
 */
export interface BatchOperation {
  type: 'set' | 'delete';
  collection: string;
  id: string;
  data?: any;
}

/**
 * Key-value store interface - vendor-neutral KV persistence
 *
 * Implementations:
 * - RedisKVStore: Redis backend for caching and session storage
 * - MemoryKVStore: In-memory backend for testing
 */
export interface IKVStore {
  /**
   * Get a value by key
   */
  get<T = any>(key: string): Promise<T | null>;

  /**
   * Set a value with optional TTL (seconds)
   */
  set<T = any>(key: string, value: T, ttl?: number): Promise<void>;

  /**
   * Delete a key
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a key exists
   */
  exists(key: string): Promise<boolean>;

  /**
   * Get all keys matching a pattern (use with caution)
   */
  keys(pattern: string): Promise<string[]>;

  /**
   * Set expiration on a key (seconds)
   */
  expire(key: string, ttl: number): Promise<void>;

  /**
   * Increment a numeric value (atomic)
   */
  increment(key: string, delta?: number): Promise<number>;

  /**
   * Decrement a numeric value (atomic)
   */
  decrement(key: string, delta?: number): Promise<number>;

  /**
   * Check if the store is healthy and connected
   */
  health(): Promise<{ healthy: boolean; latency?: number; error?: string }>;
}

/**
 * Persistence configuration
 */
export interface PersistenceConfig {
  driver: 'firestore' | 'postgres';

  // PostgreSQL-specific config
  postgres?: {
    connectionString: string;
    poolSize?: number;
    ssl?: boolean;
  };

  // Firestore-specific config
  firestore?: {
    projectId?: string;
    emulatorHost?: string;
  };

  // KV store config (optional)
  kv?: {
    driver: 'redis' | 'memory';
    redis?: {
      host: string;
      port: number;
      password?: string;
      db?: number;
    };
  };
}

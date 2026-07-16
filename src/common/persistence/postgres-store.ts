/**
 * PostgreSQL Document Store Implementation
 *
 * JSONB-based document storage compatible with IDocumentStore interface.
 * Uses connection pooling for performance and polling-based watch for real-time updates.
 */

import { Pool, PoolClient, QueryResult } from 'pg';
import {
  IDocumentStore,
  QueryOptions,
  QueryFilter,
  BatchOperation,
  VectorOrderBy,
} from './interfaces';

/**
 * Type guard to detect if orderBy is VectorOrderBy
 */
function isVectorOrderBy(orderBy: any): orderBy is VectorOrderBy {
  return orderBy && 'vector' in orderBy && 'distanceMeasure' in orderBy;
}

export interface PostgresStoreConfig {
  connectionString: string;
  poolSize?: number;
  ssl?: boolean;
}

export class PostgresDocumentStore implements IDocumentStore {
  private pool: Pool;
  private logger: any; // Will use BitBrat logger in services

  constructor(config: PostgresStoreConfig) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      max: config.poolSize || 10,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    });

    // Initialize logger (can be overridden by services)
    this.logger = console;
  }

  /**
   * Set custom logger (typically from Bit.getLogger())
   */
  setLogger(logger: any): void {
    this.logger = logger;
  }

  /**
   * Get a single document by ID
   */
  async get<T = any>(collection: string, id: string): Promise<T | null> {
    const startTime = Date.now();
    try {
      const result = await this.pool.query(
        `SELECT data FROM ${this.sanitizeCollectionName(collection)} WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const latency = Date.now() - startTime;
      this.logger.debug?.(`[PostgresDocumentStore] get ${collection}/${id} (${latency}ms)`);

      return result.rows[0].data as T;
    } catch (error) {
      this.logger.error?.(`[PostgresDocumentStore] get error:`, error);
      throw error;
    }
  }

  /**
   * Set (create or update) a document
   */
  async set<T = any>(collection: string, id: string, data: T): Promise<void> {
    const startTime = Date.now();
    try {
      await this.pool.query(
        `INSERT INTO ${this.sanitizeCollectionName(collection)} (id, data, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
        [id, JSON.stringify(data)]
      );

      const latency = Date.now() - startTime;
      this.logger.debug?.(`[PostgresDocumentStore] set ${collection}/${id} (${latency}ms)`);
    } catch (error) {
      this.logger.error?.(`[PostgresDocumentStore] set error:`, error);
      throw error;
    }
  }

  /**
   * Delete a document by ID
   */
  async delete(collection: string, id: string): Promise<void> {
    const startTime = Date.now();
    try {
      await this.pool.query(
        `DELETE FROM ${this.sanitizeCollectionName(collection)} WHERE id = $1`,
        [id]
      );

      const latency = Date.now() - startTime;
      this.logger.debug?.(`[PostgresDocumentStore] delete ${collection}/${id} (${latency}ms)`);
    } catch (error) {
      this.logger.error?.(`[PostgresDocumentStore] delete error:`, error);
      throw error;
    }
  }

  /**
   * Query documents with filters, ordering, and pagination
   * Supports both regular field ordering and vector similarity search.
   */
  async query<T = any>(collection: string, options: QueryOptions): Promise<T[]> {
    const startTime = Date.now();
    try {
      const params: any[] = [];
      let paramCount = 0;

      // Check if this is a vector search query
      const isVectorSearch = options.orderBy && isVectorOrderBy(options.orderBy);

      let sql: string;
      if (isVectorSearch) {
        // Vector search query with distance calculation
        const vectorOrder = options.orderBy as VectorOrderBy;
        const distanceOp = this.getDistanceOperator(vectorOrder.distanceMeasure);

        paramCount++;
        sql = `SELECT data, (data->'${vectorOrder.field}' ${distanceOp} $${paramCount}::vector) AS distance
               FROM ${this.sanitizeCollectionName(collection)}`;
        params.push(JSON.stringify(vectorOrder.vector));
      } else {
        // Regular query
        sql = `SELECT data FROM ${this.sanitizeCollectionName(collection)}`;
      }

      // Build WHERE clause from filters
      if (options.filters && options.filters.length > 0) {
        const whereClauses = options.filters.map((filter) => {
          paramCount++;
          return this.buildWhereClause(filter, paramCount);
        });
        sql += ` WHERE ${whereClauses.join(' AND ')}`;
        params.push(...options.filters.map((f) => f.value));
      }

      // ORDER BY
      if (options.orderBy) {
        if (isVectorSearch) {
          // Vector search ordering by distance
          const direction = options.orderBy.direction === 'desc' ? 'DESC' : 'ASC';
          sql += ` ORDER BY distance ${direction}`;
        } else {
          // Regular field ordering
          const direction = options.orderBy.direction === 'desc' ? 'DESC' : 'ASC';
          sql += ` ORDER BY data->>'${options.orderBy.field}' ${direction}`;
        }
      }

      // LIMIT and OFFSET
      if (options.limit) {
        sql += ` LIMIT ${options.limit}`;
      }
      if (options.offset) {
        sql += ` OFFSET ${options.offset}`;
      }

      const result = await this.pool.query(sql, params);
      const latency = Date.now() - startTime;

      this.logger.debug?.(
        `[PostgresDocumentStore] query ${collection} (${result.rows.length} rows, ${latency}ms)${isVectorSearch ? ' [vector search]' : ''}`
      );

      return result.rows.map((row) => row.data as T);
    } catch (error) {
      this.logger.error?.(`[PostgresDocumentStore] query error:`, error);
      throw error;
    }
  }

  /**
   * Get all documents in a collection (use with caution)
   */
  async getAll<T = any>(collection: string): Promise<T[]> {
    return this.query<T>(collection, {});
  }

  /**
   * Watch for changes to a collection (polling-based)
   *
   * PostgreSQL doesn't have native real-time push like Firestore.
   * We implement polling with configurable interval (default 5s).
   *
   * For production use cases requiring true push updates, consider:
   * - PostgreSQL LISTEN/NOTIFY
   * - pg_notify triggers
   * - External pub/sub (NATS, Redis)
   */
  watch<T = any>(
    collection: string,
    callback: (documents: T[]) => void,
    pollInterval = 5000
  ): () => void {
    let stopped = false;
    let lastSnapshot: string | null = null;

    const poll = async () => {
      if (stopped) return;

      try {
        const docs = await this.query<T>(collection, {});
        const currentSnapshot = JSON.stringify(docs);

        // Only trigger callback if data changed
        if (currentSnapshot !== lastSnapshot) {
          lastSnapshot = currentSnapshot;
          callback(docs);
        }
      } catch (error) {
        this.logger.error?.(`[PostgresDocumentStore] watch error:`, error);
      }

      if (!stopped) {
        setTimeout(poll, pollInterval);
      }
    };

    // Start polling immediately
    poll();

    // Return unsubscribe function
    return () => {
      stopped = true;
      this.logger.debug?.(`[PostgresDocumentStore] unsubscribed from ${collection}`);
    };
  }

  /**
   * Batch write operations (transactional)
   */
  async batch(operations: BatchOperation[]): Promise<void> {
    const client: PoolClient = await this.pool.connect();

    try {
      await client.query('BEGIN');

      for (const op of operations) {
        if (op.type === 'set') {
          await client.query(
            `INSERT INTO ${this.sanitizeCollectionName(op.collection)} (id, data, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
            [op.id, JSON.stringify(op.data)]
          );
        } else if (op.type === 'delete') {
          await client.query(
            `DELETE FROM ${this.sanitizeCollectionName(op.collection)} WHERE id = $1`,
            [op.id]
          );
        }
      }

      await client.query('COMMIT');
      this.logger.debug?.(`[PostgresDocumentStore] batch committed (${operations.length} ops)`);
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error?.(`[PostgresDocumentStore] batch error, rolled back:`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check if the store is healthy and connected
   */
  async health(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
    const startTime = Date.now();
    try {
      await this.pool.query('SELECT 1');
      const latency = Date.now() - startTime;
      return { healthy: true, latency };
    } catch (error: any) {
      return {
        healthy: false,
        error: error.message || 'Unknown error',
      };
    }
  }

  /**
   * Close the connection pool (for graceful shutdown)
   */
  async close(): Promise<void> {
    await this.pool.end();
    this.logger.info?.('[PostgresDocumentStore] Connection pool closed');
  }

  /**
   * Build WHERE clause for a single filter
   */
  private buildWhereClause(filter: QueryFilter, paramIndex: number): string {
    const field = filter.field;
    const operator = filter.operator;

    switch (operator) {
      case '==':
        return `data->>'${field}' = $${paramIndex}`;
      case '!=':
        return `data->>'${field}' != $${paramIndex}`;
      case '<':
        return `(data->>'${field}')::numeric < $${paramIndex}`;
      case '<=':
        return `(data->>'${field}')::numeric <= $${paramIndex}`;
      case '>':
        return `(data->>'${field}')::numeric > $${paramIndex}`;
      case '>=':
        return `(data->>'${field}')::numeric >= $${paramIndex}`;
      case 'in':
        return `data->>'${field}' = ANY($${paramIndex})`;
      case 'array-contains':
        return `data->'${field}' @> $${paramIndex}::jsonb`;
      case 'array-contains-any':
        return `data->'${field}' ?| $${paramIndex}`;
      default:
        throw new Error(`Unsupported operator: ${operator}`);
    }
  }

  /**
   * Get pgvector distance operator based on measure
   */
  private getDistanceOperator(measure: 'COSINE' | 'L2' | 'INNER_PRODUCT'): string {
    switch (measure) {
      case 'COSINE':
        return '<=>'; // Cosine distance
      case 'L2':
        return '<->'; // Euclidean distance (L2)
      case 'INNER_PRODUCT':
        return '<#>'; // Negative inner product
      default:
        throw new Error(`Unsupported distance measure: ${measure}`);
    }
  }

  /**
   * Sanitize collection name for SQL (prevent injection)
   */
  private sanitizeCollectionName(name: string): string {
    // Collection names must be valid PostgreSQL table names
    // Allow alphanumeric, underscores, hyphens
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error(`Invalid collection name: ${name}`);
    }
    return name;
  }
}

/**
 * PostgreSQL DocumentStore Adapter
 *
 * Implements DocumentStore interface using PostgreSQL JSONB columns.
 * Provides vendor-neutral document storage for composition registry.
 *
 * @module composition/postgres-document-store
 * @version 1.0.0
 * @see architecture-revision-documentstore.md
 */

import { Pool, PoolClient } from 'pg';
import { DocumentStore } from './registry';

/**
 * PostgreSQL DocumentStore
 *
 * Stores documents as JSONB in a single `documents` table with:
 * - id (TEXT): Document ID
 * - collection (TEXT): Collection name
 * - data (JSONB): Document data
 * - created_at (TIMESTAMP): Creation time
 * - updated_at (TIMESTAMP): Last update time
 *
 * Supports querying via JSONB operators (@>, ->, etc.)
 *
 * @example
 * ```typescript
 * const store = new PostgresDocumentStore(pool);
 * await store.initialize();
 *
 * // Store document
 * await store.put('compositions', 'id-123', { name: 'test', version: 1 });
 *
 * // Retrieve document
 * const doc = await store.get('compositions', 'id-123');
 *
 * // Query documents
 * const results = await store.query('compositions', { name: 'test' });
 * ```
 */
export class PostgresDocumentStore implements DocumentStore {
  constructor(private pool: Pool) {}

  /**
   * Initialize the document store
   *
   * Creates the `documents` table and indexes if they don't exist.
   * Safe to call multiple times (idempotent).
   */
  async initialize(): Promise<void> {
    const client = await this.pool.connect();

    try {
      // Create documents table
      await client.query(`
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT NOT NULL,
          collection TEXT NOT NULL,
          data JSONB NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          PRIMARY KEY (collection, id)
        )
      `);

      // Create indexes for common queries
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_documents_collection
        ON documents (collection)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_documents_data_gin
        ON documents USING GIN (data)
      `);
    } finally {
      client.release();
    }
  }

  /**
   * Store a document
   *
   * @param collection - Collection name
   * @param id - Document ID
   * @param data - Document data (will be serialized to JSONB)
   */
  async put(collection: string, id: string, data: unknown): Promise<void> {
    const serialized = this.serialize(data);

    await this.pool.query(
      `
      INSERT INTO documents (id, collection, data, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (collection, id)
      DO UPDATE SET
        data = EXCLUDED.data,
        updated_at = NOW()
      `,
      [id, collection, serialized]
    );
  }

  /**
   * Retrieve a document
   *
   * @param collection - Collection name
   * @param id - Document ID
   * @returns Document data or null if not found
   */
  async get(collection: string, id: string): Promise<unknown | null> {
    const result = await this.pool.query(
      `
      SELECT data
      FROM documents
      WHERE collection = $1 AND id = $2
      `,
      [collection, id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.deserialize(result.rows[0].data);
  }

  /**
   * Delete a document
   *
   * @param collection - Collection name
   * @param id - Document ID
   */
  async delete(collection: string, id: string): Promise<void> {
    await this.pool.query(
      `
      DELETE FROM documents
      WHERE collection = $1 AND id = $2
      `,
      [collection, id]
    );
  }

  /**
   * Query documents
   *
   * Supports equality filters on top-level fields.
   * Uses JSONB containment operator (@>) for efficient querying.
   *
   * @param collection - Collection name
   * @param query - Query filters (e.g., { name: 'test', version: 1 })
   * @returns Array of matching documents
   */
  async query(collection: string, query: Record<string, unknown>): Promise<unknown[]> {
    let sql: string;
    let params: unknown[];

    if (Object.keys(query).length === 0) {
      // No filters - return all documents in collection
      sql = `
        SELECT data
        FROM documents
        WHERE collection = $1
        ORDER BY created_at ASC
      `;
      params = [collection];
    } else {
      // Use JSONB containment operator for filtering
      const queryJson = this.serialize(query);
      sql = `
        SELECT data
        FROM documents
        WHERE collection = $1
          AND data @> $2::jsonb
        ORDER BY created_at ASC
      `;
      params = [collection, queryJson];
    }

    const result = await this.pool.query(sql, params);

    return result.rows.map((row) => this.deserialize(row.data));
  }

  /**
   * Serialize data to JSONB
   *
   * Handles Date objects by converting to ISO 8601 strings.
   */
  private serialize(data: unknown): string {
    return JSON.stringify(data, (key, value) => {
      if (value instanceof Date) {
        return value.toISOString();
      }
      return value;
    });
  }

  /**
   * Deserialize JSONB to objects
   *
   * Restores Date objects from ISO 8601 strings.
   */
  private deserialize(data: unknown): unknown {
    if (typeof data === 'string') {
      return JSON.parse(data, this.dateReviver);
    } else if (typeof data === 'object' && data !== null) {
      // Already parsed by pg driver
      return this.reviveDates(data);
    }
    return data;
  }

  /**
   * JSON.parse reviver for Date objects
   */
  private dateReviver(key: string, value: unknown): unknown {
    if (typeof value === 'string') {
      // Check if string looks like ISO 8601 date
      const datePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;
      if (datePattern.test(value)) {
        return new Date(value);
      }
    }
    return value;
  }

  /**
   * Recursively revive Date objects in parsed JSON
   */
  private reviveDates(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      // Check if string looks like ISO 8601 date
      const datePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;
      if (datePattern.test(obj)) {
        return new Date(obj);
      }
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.reviveDates(item));
    }

    if (typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.reviveDates(value);
      }
      return result;
    }

    return obj;
  }

  /**
   * Clear all documents in a collection
   *
   * Useful for testing. Use with caution in production.
   *
   * @param collection - Collection name
   */
  async clear(collection: string): Promise<void> {
    await this.pool.query(
      `
      DELETE FROM documents
      WHERE collection = $1
      `,
      [collection]
    );
  }

  /**
   * Get document count for a collection
   *
   * @param collection - Collection name
   * @returns Number of documents
   */
  async count(collection: string): Promise<number> {
    const result = await this.pool.query(
      `
      SELECT COUNT(*) as count
      FROM documents
      WHERE collection = $1
      `,
      [collection]
    );

    return parseInt(result.rows[0].count, 10);
  }
}

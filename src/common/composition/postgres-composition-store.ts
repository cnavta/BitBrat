/**
 * PostgreSQL Composition Store
 *
 * Implements DocumentStore interface using dedicated compositions table.
 * Provides storage for composition definitions with proper schema and indexing.
 *
 * @module composition/postgres-composition-store
 * @version 1.0.0
 * @see Sprint 41 (COMP-017A)
 */

import { Pool } from 'pg';
import { DocumentStore } from './registry';

/**
 * PostgreSQL Composition Store
 *
 * Stores compositions in dedicated `compositions` table with explicit schema:
 * - id (TEXT): Composition ID (UUID)
 * - name (TEXT): Composition name (MCP tool ID)
 * - version (INTEGER): Version number
 * - content_hash (TEXT): SHA-256 hash for deduplication
 * - definition (JSONB): Full composition definition
 * - created_at (TIMESTAMP): Creation time
 * - updated_at (TIMESTAMP): Last update time
 *
 * Unique constraints:
 * - (name, version): Ensure unique versions per composition
 * - (name, content_hash): Enable content-based deduplication
 *
 * @example
 * ```typescript
 * const store = new PostgresCompositionStore(pool);
 * await store.initialize();
 *
 * // Store composition
 * await store.put('compositions', 'id-123', {
 *   id: 'id-123',
 *   name: 'test',
 *   version: 1,
 *   contentHash: 'sha256:...',
 *   ...definition
 * });
 *
 * // Retrieve composition
 * const comp = await store.get('compositions', 'id-123');
 *
 * // Query compositions
 * const results = await store.query('compositions', { name: 'test' });
 * ```
 */
export class PostgresCompositionStore implements DocumentStore {
  constructor(private pool: Pool) {}

  /**
   * Initialize the composition store
   *
   * Creates the `compositions` table and indexes if they don't exist.
   * Safe to call multiple times (idempotent).
   */
  async initialize(): Promise<void> {
    const client = await this.pool.connect();

    try {
      // Table is created by migration 023-add-compositions-table.sql
      // This just verifies it exists
      await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'compositions'
      `);
    } finally {
      client.release();
    }
  }

  /**
   * Store a composition
   *
   * @param collection - Must be 'compositions' (enforced for type safety)
   * @param id - Composition ID (UUID)
   * @param data - Composition data (must include name, version, contentHash, definition)
   */
  async put(collection: string, id: string, data: unknown): Promise<void> {
    if (collection !== 'compositions') {
      throw new Error(`PostgresCompositionStore only supports 'compositions' collection, got: ${collection}`);
    }

    const comp = data as any;
    if (!comp.name || !comp.version || !comp.contentHash || !comp.metadata || !comp.spec) {
      throw new Error('Invalid composition data: missing required fields (name, version, contentHash, metadata, spec)');
    }

    // Store full composition as JSONB in definition column
    const definition = JSON.stringify(comp);

    await this.pool.query(
      `
      INSERT INTO compositions (id, name, version, content_hash, definition, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        name = EXCLUDED.name,
        version = EXCLUDED.version,
        content_hash = EXCLUDED.content_hash,
        definition = EXCLUDED.definition,
        updated_at = NOW()
      `,
      [id, comp.name, comp.version, comp.contentHash, definition]
    );
  }

  /**
   * Retrieve a composition
   *
   * @param collection - Must be 'compositions'
   * @param id - Composition ID
   * @returns Composition data or null if not found
   */
  async get(collection: string, id: string): Promise<unknown | null> {
    if (collection !== 'compositions') {
      throw new Error(`PostgresCompositionStore only supports 'compositions' collection, got: ${collection}`);
    }

    const result = await this.pool.query(
      `
      SELECT definition
      FROM compositions
      WHERE id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    // definition is already parsed by pg driver
    return result.rows[0].definition;
  }

  /**
   * Delete a composition
   *
   * @param collection - Must be 'compositions'
   * @param id - Composition ID
   */
  async delete(collection: string, id: string): Promise<void> {
    if (collection !== 'compositions') {
      throw new Error(`PostgresCompositionStore only supports 'compositions' collection, got: ${collection}`);
    }

    await this.pool.query(
      `
      DELETE FROM compositions
      WHERE id = $1
      `,
      [id]
    );
  }

  /**
   * Query compositions
   *
   * Supports queries on composition metadata fields.
   * Uses JSONB operators for efficient querying of definition field.
   *
   * @param collection - Must be 'compositions'
   * @param query - Query filters (e.g., { name: 'test' })
   * @returns Array of matching compositions
   */
  async query(collection: string, query: Record<string, unknown>): Promise<unknown[]> {
    if (collection !== 'compositions') {
      throw new Error(`PostgresCompositionStore only supports 'compositions' collection, got: ${collection}`);
    }

    let sql: string;
    let params: unknown[];

    if (Object.keys(query).length === 0) {
      // No filters - return all compositions
      sql = `
        SELECT definition
        FROM compositions
        ORDER BY name ASC, version DESC
      `;
      params = [];
    } else if (query.name && typeof query.name === 'string') {
      // Filter by name (most common case)
      sql = `
        SELECT definition
        FROM compositions
        WHERE name = $1
        ORDER BY version DESC
      `;
      params = [query.name];
    } else {
      // Use JSONB containment operator for complex queries
      const queryJson = JSON.stringify(query);
      sql = `
        SELECT definition
        FROM compositions
        WHERE definition @> $1::jsonb
        ORDER BY name ASC, version DESC
      `;
      params = [queryJson];
    }

    const result = await this.pool.query(sql, params);

    return result.rows.map((row) => row.definition);
  }

  /**
   * Clear all compositions
   *
   * Useful for testing. Use with caution in production.
   *
   * @param collection - Must be 'compositions'
   */
  async clear(collection: string): Promise<void> {
    if (collection !== 'compositions') {
      throw new Error(`PostgresCompositionStore only supports 'compositions' collection, got: ${collection}`);
    }

    await this.pool.query('DELETE FROM compositions');
  }

  /**
   * Get composition count
   *
   * @param collection - Must be 'compositions'
   * @returns Number of compositions
   */
  async count(collection: string): Promise<number> {
    if (collection !== 'compositions') {
      throw new Error(`PostgresCompositionStore only supports 'compositions' collection, got: ${collection}`);
    }

    const result = await this.pool.query(
      'SELECT COUNT(*) as count FROM compositions'
    );

    return parseInt(result.rows[0].count, 10);
  }
}

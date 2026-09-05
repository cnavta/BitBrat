/**
 * Composition Registry
 *
 * Manages compiled compositions with CRUD operations, version management,
 * and deduplication via content hashing.
 *
 * Uses DocumentStore pattern for persistence (PostgreSQL or Firestore).
 *
 * @module composition/registry
 * @version 1.0.0
 * @see technical-architecture.md §4.5
 */

import { randomUUID } from 'crypto';
import {
  CompiledComposition,
  CompositionDefinition,
  CompositionErrorCode,
} from './types';
import { CompositionCompiler, ToolRegistryInterface } from './compiler';

/**
 * DocumentStore interface for composition persistence
 *
 * Vendor-neutral abstraction for PostgreSQL, Firestore, etc.
 */
export interface DocumentStore {
  /**
   * Store a document
   *
   * @param collection - Collection name
   * @param id - Document ID
   * @param data - Document data
   */
  put(collection: string, id: string, data: unknown): Promise<void>;

  /**
   * Retrieve a document
   *
   * @param collection - Collection name
   * @param id - Document ID
   * @returns Document data or null if not found
   */
  get(collection: string, id: string): Promise<unknown | null>;

  /**
   * Delete a document
   *
   * @param collection - Collection name
   * @param id - Document ID
   */
  delete(collection: string, id: string): Promise<void>;

  /**
   * Query documents
   *
   * @param collection - Collection name
   * @param query - Query filters
   * @returns Array of matching documents
   */
  query(collection: string, query: Record<string, unknown>): Promise<unknown[]>;
}

/**
 * Composition metadata for persistence
 *
 * Stored alongside compiled composition in DocumentStore
 */
interface CompositionRecord {
  /** Unique composition ID (UUID) */
  id: string;

  /** Logical name (tool ID) */
  name: string;

  /** Version number */
  version: number;

  /** Content hash (for deduplication) */
  contentHash: string;

  /** Raw composition definition (for database storage) */
  definition?: CompositionDefinition;

  /** Compiled composition */
  compiled: CompiledComposition;

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Registry error
 */
export class RegistryError extends Error {
  constructor(
    public code: CompositionErrorCode,
    message: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'RegistryError';
  }
}

/**
 * Composition Registry
 *
 * Manages lifecycle of compiled compositions:
 * - Storage in DocumentStore (PostgreSQL/Firestore)
 * - Version management (auto-increment)
 * - Deduplication via content hashing
 * - CRUD operations
 * - Lookup by name, version, hash
 *
 * @example
 * ```typescript
 * const registry = new CompositionRegistry(documentStore, toolRegistry);
 *
 * // Register new composition
 * const compiled = await registry.register(definition);
 *
 * // Retrieve composition
 * const composition = await registry.get('viewer_greeting', 2);
 *
 * // List all versions
 * const versions = await registry.listVersions('viewer_greeting');
 * ```
 */
export class CompositionRegistry {
  private compiler: CompositionCompiler;
  private collection = 'compositions';

  constructor(
    private store: DocumentStore,
    private toolRegistry: ToolRegistryInterface
  ) {
    this.compiler = new CompositionCompiler(toolRegistry);
  }

  /**
   * Register a new composition
   *
   * Compiles and stores the composition. If a composition with the same
   * content hash already exists, returns the existing composition.
   *
   * @param definition - Composition definition to register
   * @returns Compiled composition with assigned ID
   */
  async register(definition: CompositionDefinition): Promise<CompiledComposition> {
    // Compile composition
    const compiled = this.compiler.compile(definition);

    // Check for existing composition with same content hash (deduplication)
    const existing = await this.findByContentHash(compiled.contentHash);
    if (existing) {
      // Return existing composition (deduplicated)
      return existing.compiled;
    }

    // Determine version number
    const versions = await this.listVersions(definition.metadata.name);
    const version = versions.length > 0 ? Math.max(...versions.map((v) => v.version)) + 1 : 1;

    // Assign ID and version
    const id = randomUUID();
    compiled.id = id;
    compiled.metadata.version = version;

    // Create record (Sprint 42: Store both definition and compiled for compatibility)
    const record: CompositionRecord = {
      id,
      name: definition.metadata.name,
      version,
      contentHash: compiled.contentHash,
      definition, // Raw definition for database storage (Sprint 42)
      compiled,   // Compiled version for in-memory operations
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Store in DocumentStore
    await this.store.put(this.collection, id, record);

    return compiled;
  }

  /**
   * Update an existing composition
   *
   * Creates a new version with incremented version number.
   * Previous versions remain accessible.
   *
   * @param definition - Updated composition definition
   * @returns New compiled composition
   */
  async update(definition: CompositionDefinition): Promise<CompiledComposition> {
    // Update is implemented as register with version increment
    return await this.register(definition);
  }

  /**
   * Get a composition by name and version
   *
   * @param name - Composition name
   * @param version - Version number (defaults to latest)
   * @returns Compiled composition or null if not found
   */
  async get(name: string, version?: number): Promise<CompiledComposition | null> {
    if (version !== undefined) {
      // Get specific version
      const results = await this.store.query(this.collection, { name, version });
      if (results.length === 0) {
        return null;
      }
      const record = results[0] as CompositionRecord;
      return record.compiled;
    } else {
      // Get latest version
      const versions = await this.listVersions(name);
      if (versions.length === 0) {
        return null;
      }

      // Find latest version
      const latest = versions.reduce((prev, curr) =>
        curr.version > prev.version ? curr : prev
      );

      return latest.compiled;
    }
  }

  /**
   * Get a composition by ID
   *
   * @param id - Composition ID (UUID)
   * @returns Compiled composition or null if not found
   */
  async getById(id: string): Promise<CompiledComposition | null> {
    const data = await this.store.get(this.collection, id);
    if (!data) {
      return null;
    }

    const record = data as CompositionRecord;
    return record.compiled;
  }

  /**
   * Delete a composition
   *
   * Removes specific version from registry.
   *
   * @param name - Composition name
   * @param version - Version number
   */
  async delete(name: string, version: number): Promise<void> {
    const results = await this.store.query(this.collection, { name, version });
    if (results.length === 0) {
      throw new RegistryError(
        CompositionErrorCode.TOOL_NOT_FOUND,
        `Composition not found: ${name} v${version}`
      );
    }

    const record = results[0] as CompositionRecord;
    await this.store.delete(this.collection, record.id);
  }

  /**
   * List all versions of a composition
   *
   * @param name - Composition name
   * @returns Array of composition records, sorted by version
   */
  async listVersions(name: string): Promise<CompositionRecord[]> {
    const results = await this.store.query(this.collection, { name });
    const records = results as CompositionRecord[];

    // Sort by version (ascending)
    return records.sort((a, b) => a.version - b.version);
  }

  /**
   * List all compositions
   *
   * Loads compositions from database and compiles them into executable format.
   * Handles both compositions registered via MCP tools and those inserted directly via SQL.
   *
   * Database records contain raw `definition` field (JSONB composition YAML).
   * This method compiles each definition using CompositionCompiler to produce
   * executable CompiledComposition objects.
   *
   * Invalid compositions are logged and skipped - loading continues for valid compositions.
   *
   * Sprint 42: Enhanced to compile definitions on load and handle database schema mapping
   *
   * @returns Array of all composition records with compiled definitions
   */
  async list(): Promise<CompositionRecord[]> {
    const results = await this.store.query(this.collection, {});

    const records: CompositionRecord[] = [];

    for (const row of results) {
      try {
        // Database schema: {id, name, version, content_hash, definition, created_at, updated_at}
        // Sprint 42: PostgresCompositionStore now returns full row with all columns
        const dbRow = row as any;

        // Validate that we have the required fields
        if (!dbRow.name || !dbRow.definition) {
          console.error(
            `[CompositionRegistry] Skipping invalid composition record - missing name or definition:`,
            {
              hasName: !!dbRow.name,
              hasDefinition: !!dbRow.definition,
              rowKeys: Object.keys(dbRow),
              id: dbRow.id || 'unknown'
            }
          );
          continue;
        }

        // Parse definition (raw composition YAML as JSONB)
        const definition = dbRow.definition as CompositionDefinition;

        // Additional validation: ensure definition has required structure
        if (!definition || typeof definition !== 'object') {
          console.error(
            `[CompositionRegistry] Skipping composition ${dbRow.name}:${dbRow.version} - definition is not an object:`,
            { definitionType: typeof definition }
          );
          continue;
        }

        // Compile definition to get executable composition
        const compiled = this.compiler.compile(definition);

        // Construct properly-typed CompositionRecord
        // Handle both snake_case (database) and camelCase (TypeScript) field names
        records.push({
          id: dbRow.id,
          name: dbRow.name,
          version: dbRow.version,
          contentHash: dbRow.content_hash || dbRow.contentHash,
          compiled,
          createdAt: dbRow.created_at ? new Date(dbRow.created_at) : dbRow.createdAt,
          updatedAt: dbRow.updated_at ? new Date(dbRow.updated_at) : dbRow.updatedAt,
        });
      } catch (err) {
        // Log compilation error but continue loading other compositions
        // This allows the system to remain functional even if some compositions are invalid
        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorStack = err instanceof Error ? err.stack : undefined;
        const dbRow = row as any;

        console.error(
          `[CompositionRegistry] Failed to compile composition ${dbRow.name}:${dbRow.version}:`,
          errorMessage,
          errorStack
        );

        // Continue processing other compositions
        continue;
      }
    }

    return records;
  }

  /**
   * Find composition by content hash
   *
   * Used for deduplication - if content hash matches, same composition.
   *
   * @param contentHash - SHA-256 content hash
   * @returns Composition record or null if not found
   */
  async findByContentHash(contentHash: string): Promise<CompositionRecord | null> {
    const results = await this.store.query(this.collection, { contentHash });
    if (results.length === 0) {
      return null;
    }

    return results[0] as CompositionRecord;
  }

  /**
   * Check if composition exists
   *
   * @param name - Composition name
   * @param version - Optional version number
   * @returns True if composition exists
   */
  async exists(name: string, version?: number): Promise<boolean> {
    const composition = await this.get(name, version);
    return composition !== null;
  }

  /**
   * Get all compositions that depend on a tool
   *
   * @param toolId - Tool ID to search for
   * @returns Array of compositions that depend on the tool
   */
  async findDependents(toolId: string): Promise<CompiledComposition[]> {
    const allCompositions = await this.list();
    const dependents: CompiledComposition[] = [];

    for (const record of allCompositions) {
      const hasDependency = record.compiled.dependencies.some(
        (dep) => dep.toolId === toolId
      );

      if (hasDependency) {
        dependents.push(record.compiled);
      }
    }

    return dependents;
  }

  /**
   * Validate that all tool dependencies exist
   *
   * @param composition - Compiled composition to validate
   * @returns True if all dependencies exist
   */
  async validateDependencies(composition: CompiledComposition): Promise<boolean> {
    for (const dep of composition.dependencies) {
      const tool = this.toolRegistry.getTool(dep.toolId);
      if (!tool) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get composition statistics
   *
   * @returns Registry statistics
   */
  async getStats(): Promise<{
    totalCompositions: number;
    totalVersions: number;
    compositionsByName: Record<string, number>;
  }> {
    const allRecords = await this.list();

    const compositionsByName: Record<string, number> = {};
    for (const record of allRecords) {
      compositionsByName[record.name] = (compositionsByName[record.name] || 0) + 1;
    }

    return {
      totalCompositions: Object.keys(compositionsByName).length,
      totalVersions: allRecords.length,
      compositionsByName,
    };
  }
}

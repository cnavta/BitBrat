/**
 * Composition Registry Integration Tests
 *
 * Tests for CompositionRegistry covering:
 * - Registration and CRUD operations (6 tests)
 * - Version management (4 tests)
 * - Deduplication (2 tests)
 * - Dependency validation (2 tests)
 * - Statistics (1 test)
 *
 * @module composition/registry.test
 */

import {
  CompositionRegistry,
  DocumentStore,
  RegistryError,
} from './registry';
import { ToolRegistryInterface } from './compiler';
import { CompositionDefinition } from './types';

// Mock DocumentStore
class MockDocumentStore implements DocumentStore {
  private data: Map<string, Map<string, unknown>> = new Map();

  async put(collection: string, id: string, data: unknown): Promise<void> {
    if (!this.data.has(collection)) {
      this.data.set(collection, new Map());
    }
    this.data.get(collection)!.set(id, data);
  }

  async get(collection: string, id: string): Promise<unknown | null> {
    const coll = this.data.get(collection);
    if (!coll) {
      return null;
    }
    return coll.get(id) || null;
  }

  async delete(collection: string, id: string): Promise<void> {
    const coll = this.data.get(collection);
    if (coll) {
      coll.delete(id);
    }
  }

  async query(collection: string, query: Record<string, unknown>): Promise<unknown[]> {
    const coll = this.data.get(collection);
    if (!coll) {
      return [];
    }

    const results: unknown[] = [];
    for (const doc of coll.values()) {
      // Simple equality-based filtering
      let matches = true;
      for (const [key, value] of Object.entries(query)) {
        if ((doc as any)[key] !== value) {
          matches = false;
          break;
        }
      }
      if (matches) {
        results.push(doc);
      }
    }

    return results;
  }

  clear() {
    this.data.clear();
  }
}

// Mock ToolRegistry
class MockToolRegistry implements ToolRegistryInterface {
  private tools: Map<string, { id: string; inputSchema?: unknown }> = new Map();

  addTool(id: string, inputSchema?: unknown) {
    this.tools.set(id, { id, inputSchema });
  }

  getTool(toolId: string) {
    return this.tools.get(toolId) || null;
  }

  clear() {
    this.tools.clear();
  }
}

describe('CompositionRegistry', () => {
  let registry: CompositionRegistry;
  let store: MockDocumentStore;
  let toolRegistry: MockToolRegistry;

  beforeEach(() => {
    store = new MockDocumentStore();
    toolRegistry = new MockToolRegistry();
    registry = new CompositionRegistry(store, toolRegistry);

    // Add mock tools
    toolRegistry.addTool('test.echo', { type: 'object' });
    toolRegistry.addTool('test.transform', { type: 'object' });
  });

  // Helper to create minimal composition definition
  const createDefinition = (name: string, steps: any[]): CompositionDefinition => ({
    apiVersion: 'mcp-compose/v1',
    kind: 'Composition',
    metadata: {
      name,
      description: `Test composition: ${name}`,
    },
    spec: {
      inputSchema: { type: 'object' },
      steps,
      return: { success: true },
    },
  });

  // ==========================================================================
  // Registration and CRUD Operations (6 tests)
  // ==========================================================================

  describe('Registration and CRUD', () => {
    test('registers a new composition', async () => {
      const definition = createDefinition('test_composition', [
        { id: 'step1', call: 'test.echo' },
      ]);

      const compiled = await registry.register(definition);

      expect(compiled.id).toBeDefined();
      expect(compiled.metadata.name).toBe('test_composition');
      expect(compiled.metadata.version).toBe(1);
      expect(compiled.contentHash).toBeDefined();
    });

    test('retrieves composition by name', async () => {
      const definition = createDefinition('test_composition', [
        { id: 'step1', call: 'test.echo' },
      ]);

      await registry.register(definition);
      const retrieved = await registry.get('test_composition');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.metadata.name).toBe('test_composition');
      expect(retrieved!.metadata.version).toBe(1);
    });

    test('retrieves composition by name and version', async () => {
      const def1 = createDefinition('test_composition', [
        { id: 'step1', call: 'test.echo' },
      ]);
      const def2 = createDefinition('test_composition', [
        { id: 'step1', call: 'test.echo' },
        { id: 'step2', call: 'test.transform' }, // Different content
      ]);

      await registry.register(def1);
      await registry.register(def2); // Creates v2

      const v1 = await registry.get('test_composition', 1);
      const v2 = await registry.get('test_composition', 2);

      expect(v1).not.toBeNull();
      expect(v1!.metadata.version).toBe(1);
      expect(v2).not.toBeNull();
      expect(v2!.metadata.version).toBe(2);
    });

    test('retrieves composition by ID', async () => {
      const definition = createDefinition('test_composition', [
        { id: 'step1', call: 'test.echo' },
      ]);

      const compiled = await registry.register(definition);
      const retrieved = await registry.getById(compiled.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(compiled.id);
      expect(retrieved!.metadata.name).toBe('test_composition');
    });

    test('deletes composition', async () => {
      const definition = createDefinition('test_composition', [
        { id: 'step1', call: 'test.echo' },
      ]);

      await registry.register(definition);
      await registry.delete('test_composition', 1);

      const retrieved = await registry.get('test_composition', 1);
      expect(retrieved).toBeNull();
    });

    test('checks composition existence', async () => {
      const definition = createDefinition('test_composition', [
        { id: 'step1', call: 'test.echo' },
      ]);

      const existsBefore = await registry.exists('test_composition');
      expect(existsBefore).toBe(false);

      await registry.register(definition);

      const existsAfter = await registry.exists('test_composition');
      expect(existsAfter).toBe(true);
    });
  });

  // ==========================================================================
  // Version Management (4 tests)
  // ==========================================================================

  describe('Version management', () => {
    test('auto-increments version on update', async () => {
      const def1 = createDefinition('test_composition', [
        { id: 'step1', call: 'test.echo' },
      ]);
      const def2 = createDefinition('test_composition', [
        { id: 'step1', call: 'test.echo' },
        { id: 'step2', call: 'test.transform' }, // Different content
      ]);
      const def3 = createDefinition('test_composition', [
        { id: 'step1', call: 'test.transform' }, // Different content
      ]);

      const v1 = await registry.register(def1);
      expect(v1.metadata.version).toBe(1);

      const v2 = await registry.register(def2);
      expect(v2.metadata.version).toBe(2);

      const v3 = await registry.register(def3);
      expect(v3.metadata.version).toBe(3);
    });

    test('lists all versions of a composition', async () => {
      const def1 = createDefinition('test_composition', [
        { id: 'step1', call: 'test.echo' },
      ]);
      const def2 = createDefinition('test_composition', [
        { id: 'step1', call: 'test.echo' },
        { id: 'step2', call: 'test.transform' }, // Different
      ]);
      const def3 = createDefinition('test_composition', [
        { id: 'step1', call: 'test.transform' }, // Different
      ]);

      await registry.register(def1);
      await registry.register(def2);
      await registry.register(def3);

      const versions = await registry.listVersions('test_composition');
      expect(versions).toHaveLength(3);
      expect(versions[0].version).toBe(1);
      expect(versions[1].version).toBe(2);
      expect(versions[2].version).toBe(3);
    });

    test('retrieves latest version by default', async () => {
      const def1 = createDefinition('test_composition', [
        { id: 'step1', call: 'test.echo' },
      ]);
      const def2 = createDefinition('test_composition', [
        { id: 'step1', call: 'test.echo' },
        { id: 'step2', call: 'test.transform' }, // Different
      ]);
      const def3 = createDefinition('test_composition', [
        { id: 'step1', call: 'test.transform' }, // Different
      ]);

      await registry.register(def1);
      await registry.register(def2);
      await registry.register(def3);

      const latest = await registry.get('test_composition');
      expect(latest).not.toBeNull();
      expect(latest!.metadata.version).toBe(3);
    });

    test('maintains separate versions for different compositions', async () => {
      const def1v1 = createDefinition('composition_a', [
        { id: 'step1', call: 'test.echo' },
      ]);
      const def1v2 = createDefinition('composition_a', [
        { id: 'step1', call: 'test.transform' }, // Different
      ]);
      const def2 = createDefinition('composition_b', [
        { id: 'step1', call: 'test.echo' },
      ]);

      await registry.register(def1v1);
      await registry.register(def1v2);

      await registry.register(def2);

      const versionsA = await registry.listVersions('composition_a');
      const versionsB = await registry.listVersions('composition_b');

      expect(versionsA).toHaveLength(2);
      expect(versionsB).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Deduplication (2 tests)
  // ==========================================================================

  describe('Deduplication', () => {
    test('detects duplicate composition by content hash', async () => {
      const definition = createDefinition('test_composition', [
        { id: 'step1', call: 'test.echo' },
      ]);

      const compiled1 = await registry.register(definition);
      const compiled2 = await registry.register(definition); // Same content

      // Should return same composition (deduplicated)
      expect(compiled1.id).toBe(compiled2.id);
      expect(compiled1.contentHash).toBe(compiled2.contentHash);

      const versions = await registry.listVersions('test_composition');
      expect(versions).toHaveLength(1); // Only one version stored
    });

    test('finds composition by content hash', async () => {
      const definition = createDefinition('test_composition', [
        { id: 'step1', call: 'test.echo' },
      ]);

      const compiled = await registry.register(definition);
      const found = await registry.findByContentHash(compiled.contentHash);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(compiled.id);
      expect(found!.contentHash).toBe(compiled.contentHash);
    });
  });

  // ==========================================================================
  // Dependency Validation (2 tests)
  // ==========================================================================

  describe('Dependency validation', () => {
    test('validates that all dependencies exist', async () => {
      const definition = createDefinition('test_composition', [
        { id: 'step1', call: 'test.echo' },
        { id: 'step2', call: 'test.transform' },
      ]);

      const compiled = await registry.register(definition);
      const valid = await registry.validateDependencies(compiled);

      expect(valid).toBe(true);
    });

    test('detects missing dependencies', async () => {
      // Register a composition that uses existing tools
      const definition = createDefinition('test_composition', [
        { id: 'step1', call: 'test.echo' },
      ]);

      const compiled = await registry.register(definition);

      // Remove the tool from registry to simulate missing dependency
      toolRegistry.clear();

      const valid = await registry.validateDependencies(compiled);

      expect(valid).toBe(false);
    });
  });

  // ==========================================================================
  // Find Dependents (1 test)
  // ==========================================================================

  describe('Find dependents', () => {
    test('finds compositions that depend on a tool', async () => {
      const def1 = createDefinition('composition_a', [
        { id: 'step1', call: 'test.echo' },
      ]);
      const def2 = createDefinition('composition_b', [
        { id: 'step1', call: 'test.transform' },
      ]);
      const def3 = createDefinition('composition_c', [
        { id: 'step1', call: 'test.echo' },
      ]);

      await registry.register(def1);
      await registry.register(def2);
      await registry.register(def3);

      const dependents = await registry.findDependents('test.echo');

      expect(dependents).toHaveLength(2);
      expect(dependents.map((c) => c.metadata.name).sort()).toEqual([
        'composition_a',
        'composition_c',
      ]);
    });
  });

  // ==========================================================================
  // Statistics (1 test)
  // ==========================================================================

  describe('Statistics', () => {
    test('computes registry statistics', async () => {
      const def1v1 = createDefinition('composition_a', [
        { id: 'step1', call: 'test.echo' },
      ]);
      const def1v2 = createDefinition('composition_a', [
        { id: 'step1', call: 'test.echo' },
        { id: 'step2', call: 'test.transform' }, // Different content
      ]);
      const def1v3 = createDefinition('composition_a', [
        { id: 'step1', call: 'test.transform' }, // Different content again
      ]);
      const def2 = createDefinition('composition_b', [
        { id: 'step1', call: 'test.transform' },
      ]);

      await registry.register(def1v1);
      await registry.register(def1v2);
      await registry.register(def1v3);

      await registry.register(def2);

      const stats = await registry.getStats();

      expect(stats.totalCompositions).toBe(2);
      expect(stats.totalVersions).toBe(4);
      expect(stats.compositionsByName).toEqual({
        composition_a: 3,
        composition_b: 1,
      });
    });
  });

  // ==========================================================================
  // Database Loading and Compilation (Sprint 42 - 5 tests)
  // ==========================================================================

  describe('Database loading and compilation', () => {
    test('compiles definitions from database records', async () => {
      const definition = createDefinition('test_composition', [
        { id: 'step1', call: 'test.echo' },
      ]);

      // Simulate direct database insertion (bypassing register)
      await store.put('compositions', 'test-id-1', {
        id: 'test-id-1',
        name: 'test_composition',
        version: 1,
        content_hash: 'abc123',
        definition, // Raw definition, not compiled
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const records = await registry.list();

      expect(records).toHaveLength(1);
      expect(records[0].id).toBe('test-id-1');
      expect(records[0].name).toBe('test_composition');
      expect(records[0].version).toBe(1);
      expect(records[0].compiled).toBeDefined(); // Should be compiled
      expect(records[0].compiled.metadata.name).toBe('test_composition');
    });

    test('handles snake_case database columns', async () => {
      const definition = createDefinition('test_composition', [
        { id: 'step1', call: 'test.echo' },
      ]);

      // Database returns snake_case field names
      await store.put('compositions', 'test-id-1', {
        id: 'test-id-1',
        name: 'test_composition',
        version: 1,
        content_hash: 'abc123', // snake_case
        definition,
        created_at: '2024-01-01T00:00:00.000Z', // snake_case
        updated_at: '2024-01-01T00:00:00.000Z', // snake_case
      });

      const records = await registry.list();

      expect(records).toHaveLength(1);
      expect(records[0].contentHash).toBe('abc123'); // Mapped to camelCase
      expect(records[0].createdAt).toBeInstanceOf(Date);
      expect(records[0].updatedAt).toBeInstanceOf(Date);
    });

    test('returns empty array for empty database', async () => {
      const records = await registry.list();
      expect(records).toEqual([]);
    });

    test('skips invalid compositions with error logging', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const validDef = createDefinition('valid_composition', [
        { id: 'step1', call: 'test.echo' },
      ]);

      // Insert valid composition
      await store.put('compositions', 'test-id-1', {
        id: 'test-id-1',
        name: 'valid_composition',
        version: 1,
        content_hash: 'abc123',
        definition: validDef,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Insert invalid composition (missing required fields)
      await store.put('compositions', 'test-id-2', {
        id: 'test-id-2',
        name: 'invalid_composition',
        version: 1,
        content_hash: 'def456',
        definition: { invalid: 'structure' } as any,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const records = await registry.list();

      // Should return only valid composition
      expect(records).toHaveLength(1);
      expect(records[0].name).toBe('valid_composition');

      // Should log error for invalid composition
      expect(consoleSpy).toHaveBeenCalled();
      const errorCall = consoleSpy.mock.calls.find((call) =>
        call[0].includes('Failed to compile composition')
      );
      expect(errorCall).toBeDefined();
      expect(errorCall![0]).toContain('invalid_composition');

      consoleSpy.mockRestore();
    });

    test('preserves all CompositionRecord fields', async () => {
      const definition = createDefinition('test_composition', [
        { id: 'step1', call: 'test.echo' },
      ]);

      const createdAt = '2024-01-01T10:00:00.000Z';
      const updatedAt = '2024-01-01T12:00:00.000Z';

      await store.put('compositions', 'test-id-1', {
        id: 'test-id-1',
        name: 'test_composition',
        version: 42,
        content_hash: 'abc123xyz',
        definition,
        created_at: createdAt,
        updated_at: updatedAt,
      });

      const records = await registry.list();

      expect(records).toHaveLength(1);

      const record = records[0];
      expect(record.id).toBe('test-id-1');
      expect(record.name).toBe('test_composition');
      expect(record.version).toBe(42);
      expect(record.contentHash).toBe('abc123xyz');
      expect(record.compiled).toBeDefined();
      expect(record.createdAt).toBeInstanceOf(Date);
      expect(record.updatedAt).toBeInstanceOf(Date);
      expect(record.createdAt.toISOString()).toBe(createdAt);
      expect(record.updatedAt.toISOString()).toBe(updatedAt);
    });
  });
});

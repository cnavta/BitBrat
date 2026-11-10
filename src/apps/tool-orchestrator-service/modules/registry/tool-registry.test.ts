/**
 * Tool Registry Unit Tests
 * Sprint 57: Foundation - tool-orchestrator with Persistent Registries
 */

import { ToolRegistry } from './tool-registry';
import { IDocumentStore } from '../../../../common/persistence/interfaces';
import { ToolRegistryDocument, ToolQueryFilters } from '../types';
import { Logger } from 'pino';

// Mock DocumentStore
class MockDocumentStore implements IDocumentStore {
  private data: Map<string, Map<string, any>> = new Map();

  async get<T = any>(collection: string, id: string): Promise<T | null> {
    const coll = this.data.get(collection);
    return coll?.get(id) || null;
  }

  async set<T = any>(
    collection: string,
    id: string,
    data: T,
    merge?: boolean
  ): Promise<void> {
    if (!this.data.has(collection)) {
      this.data.set(collection, new Map());
    }
    const coll = this.data.get(collection)!;

    if (merge && coll.has(id)) {
      const existing = coll.get(id);
      coll.set(id, { ...existing, ...data });
    } else {
      coll.set(id, data);
    }
  }

  async delete(collection: string, id: string): Promise<void> {
    this.data.get(collection)?.delete(id);
  }

  async query<T = any>(collection: string, options: any): Promise<T[]> {
    const coll = this.data.get(collection);
    if (!coll) return [];

    let results = Array.from(coll.values());

    // Apply filters
    if (options.filters) {
      for (const filter of options.filters) {
        results = results.filter((doc: any) => {
          const value = doc[filter.field];
          switch (filter.operator) {
            case '==':
              return value === filter.value;
            case 'in':
              return filter.value.includes(value);
            case 'array-contains':
              return Array.isArray(value) && value.includes(filter.value);
            default:
              return true;
          }
        });
      }
    }

    return results as T[];
  }

  async getAll<T = any>(collection: string): Promise<T[]> {
    const coll = this.data.get(collection);
    return coll ? Array.from(coll.values()) as T[] : [];
  }

  watch<T = any>(
    collection: string,
    callback: (documents: T[]) => void,
    pollInterval?: number
  ): () => void {
    return () => {};
  }

  async batch(operations: any[]): Promise<void> {
    // Simple implementation
    for (const op of operations) {
      if (op.type === 'set') {
        await this.set(op.collection, op.id, op.data);
      } else if (op.type === 'delete') {
        await this.delete(op.collection, op.id);
      }
    }
  }

  async health(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
    return { healthy: true, latency: 1 };
  }
}

// Mock Logger
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any as Logger;

describe('ToolRegistry', () => {
  let registry: ToolRegistry;
  let store: MockDocumentStore;

  beforeEach(() => {
    store = new MockDocumentStore();
    registry = new ToolRegistry(store, mockLogger);
  });

  describe('registerTool', () => {
    it('should register a new tool', async () => {
      const tool: ToolRegistryDocument = {
        id: 'test-tool-1',
        canonicalName: 'test.tool',
        description: 'Test tool',
        source: 'internal',
        sourceMetadata: {},
        inputSchema: { type: 'object' },
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
        config: {
          timeoutMs: 30000,
          retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
        },
        health: { status: 'healthy' },
        status: 'active',
        tags: [],
        relatedTools: [],
        importedAt: new Date(),
        lastUpdatedAt: new Date(),
      };

      await registry.registerTool(tool);

      const retrieved = await registry.getTool('test-tool-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.canonicalName).toBe('test.tool');
    });

    it('should reject duplicate canonical names', async () => {
      const tool1: ToolRegistryDocument = {
        id: 'test-tool-1',
        canonicalName: 'test.tool',
        source: 'internal',
        sourceMetadata: {},
        inputSchema: {},
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
        config: {
          timeoutMs: 30000,
          retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
        },
        health: { status: 'healthy' },
        status: 'active',
        tags: [],
        relatedTools: [],
        importedAt: new Date(),
        lastUpdatedAt: new Date(),
      };

      const tool2: ToolRegistryDocument = {
        ...tool1,
        id: 'test-tool-2',
      };

      await registry.registerTool(tool1);
      await expect(registry.registerTool(tool2)).rejects.toThrow(
        'Tool with canonical name "test.tool" already exists'
      );
    });
  });

  describe('queryTools', () => {
    beforeEach(async () => {
      const tools: ToolRegistryDocument[] = [
        {
          id: 'mcp-tool-1',
          canonicalName: 'mcp.tool1',
          source: 'mcp',
          sourceMetadata: {},
          inputSchema: {},
          rbac: {
            userRoles: { required: [], denied: [] },
            modelRoles: { required: [], denied: [] },
            modelTiers: { allowed: [], denied: [] },
          },
          config: {
            timeoutMs: 30000,
            retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
          },
          health: { status: 'healthy' },
          status: 'active',
          tags: ['mcp'],
          category: 'external',
          relatedTools: [],
          importedAt: new Date(),
          lastUpdatedAt: new Date(),
        },
        {
          id: 'internal-tool-1',
          canonicalName: 'internal.tool1',
          source: 'internal',
          sourceMetadata: {},
          inputSchema: {},
          rbac: {
            userRoles: { required: ['admin'], denied: [] },
            modelRoles: { required: [], denied: [] },
            modelTiers: { allowed: [], denied: [] },
          },
          config: {
            timeoutMs: 30000,
            retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
          },
          health: { status: 'healthy' },
          status: 'active',
          tags: ['internal'],
          category: 'admin',
          relatedTools: [],
          importedAt: new Date(),
          lastUpdatedAt: new Date(),
        },
      ];

      for (const tool of tools) {
        await store.set('platform_tool_registry', tool.id, tool);
      }
    });

    it('should filter by source', async () => {
      const filters: ToolQueryFilters = { source: ['mcp'] };
      const results = await registry.queryTools(filters);

      expect(results).toHaveLength(1);
      expect(results[0].source).toBe('mcp');
    });

    it('should filter by category', async () => {
      const filters: ToolQueryFilters = { category: 'admin' };
      const results = await registry.queryTools(filters);

      expect(results).toHaveLength(1);
      expect(results[0].category).toBe('admin');
    });

    it('should filter by tags', async () => {
      const filters: ToolQueryFilters = { tags: ['mcp'] };
      const results = await registry.queryTools(filters);

      expect(results).toHaveLength(1);
      expect(results[0].tags).toContain('mcp');
    });

    it('should apply RBAC user role filtering', async () => {
      const filters: ToolQueryFilters = {
        rbacFilter: { userRoles: ['admin'] },
      };
      const results = await registry.queryTools(filters);

      expect(results).toHaveLength(2); // Both tools (one requires admin, one has no requirement)
    });
  });

  describe('importFromMcp', () => {
    it('should import tools from MCP server', async () => {
      const mcpTools = [
        {
          name: 'test.tool1',
          description: 'Test tool 1',
          inputSchema: { type: 'object' },
        },
        {
          name: 'test.tool2',
          description: 'Test tool 2',
          inputSchema: { type: 'object' },
        },
      ];

      const importedIds = await registry.importFromMcp('test-server', mcpTools);

      expect(importedIds).toHaveLength(2);
      expect(importedIds[0]).toBe('mcp.test-server.test.tool1');
      expect(importedIds[1]).toBe('mcp.test-server.test.tool2');

      const tool = await registry.getTool('mcp.test-server.test.tool1');
      expect(tool).not.toBeNull();
      expect(tool?.source).toBe('mcp');
      expect(tool?.sourceMetadata.mcpServer?.name).toBe('test-server');
    });

    it('should update existing MCP tools on re-import', async () => {
      const mcpTools = [
        {
          name: 'test.tool1',
          description: 'Original description',
          inputSchema: { type: 'object' },
        },
      ];

      await registry.importFromMcp('test-server', mcpTools);

      const updatedTools = [
        {
          name: 'test.tool1',
          description: 'Updated description',
          inputSchema: { type: 'object', properties: { x: { type: 'string' } } },
        },
      ];

      await registry.importFromMcp('test-server', updatedTools);

      const tool = await registry.getTool('mcp.test-server.test.tool1');
      expect(tool?.description).toBe('Updated description');
    });
  });

  describe('updateHealth', () => {
    it('should update tool health status', async () => {
      const tool: ToolRegistryDocument = {
        id: 'test-tool-1',
        canonicalName: 'test.tool',
        source: 'internal',
        sourceMetadata: {},
        inputSchema: {},
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
        config: {
          timeoutMs: 30000,
          retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
        },
        health: { status: 'healthy' },
        status: 'active',
        tags: [],
        relatedTools: [],
        importedAt: new Date(),
        lastUpdatedAt: new Date(),
      };

      await registry.registerTool(tool);

      await registry.updateHealth('test-tool-1', {
        status: 'degraded',
        lastError: 'Connection timeout',
      });

      const updated = await registry.getTool('test-tool-1');
      expect(updated?.health.status).toBe('degraded');
      expect(updated?.health.lastError).toBe('Connection timeout');
      expect(updated?.health.consecutiveFailures).toBe(1);
    });
  });
});

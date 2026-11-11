/**
 * In-Memory Tool Registry
 * Sprint 58: RBAC Integration Testing
 *
 * Simple Map-based implementation for testing purposes.
 * Not suitable for production use (no persistence, no concurrency control).
 */

import {
  IToolRegistry,
  McpToolDefinition,
  BitBratTool,
} from './interfaces';
import {
  ToolRegistryDocument,
  ToolQueryFilters,
  HealthStatus,
} from '../types';

export class InMemoryToolRegistry implements IToolRegistry {
  private tools: Map<string, ToolRegistryDocument> = new Map();

  async registerTool(tool: ToolRegistryDocument): Promise<void> {
    this.tools.set(tool.id, tool);
  }

  async getTool(id: string): Promise<ToolRegistryDocument | null> {
    return this.tools.get(id) || null;
  }

  async queryTools(filters: ToolQueryFilters): Promise<ToolRegistryDocument[]> {
    let results = Array.from(this.tools.values());

    // Apply filters
    if (filters.source) {
      results = results.filter((tool) =>
        filters.source!.includes(tool.source)
      );
    }

    if (filters.status) {
      results = results.filter((tool) =>
        filters.status!.includes(tool.status)
      );
    }

    if (filters.category) {
      results = results.filter((tool) => tool.category === filters.category);
    }

    if (filters.tags) {
      results = results.filter((tool) =>
        filters.tags!.some((tag) => tool.tags.includes(tag))
      );
    }

    return results;
  }

  async updateTool(
    id: string,
    updates: Partial<ToolRegistryDocument>
  ): Promise<void> {
    const existing = this.tools.get(id);
    if (!existing) {
      throw new Error(`Tool not found: ${id}`);
    }

    this.tools.set(id, {
      ...existing,
      ...updates,
      lastUpdatedAt: new Date(),
    });
  }

  async deleteTool(id: string): Promise<void> {
    this.tools.delete(id);
  }

  async findDuplicates(
    tool: ToolRegistryDocument
  ): Promise<ToolRegistryDocument[]> {
    return Array.from(this.tools.values()).filter(
      (t) =>
        t.id !== tool.id &&
        (t.canonicalName === tool.canonicalName ||
          (t.source === 'mcp' &&
            tool.source === 'mcp' &&
            t.sourceMetadata.mcpServer?.name ===
              tool.sourceMetadata.mcpServer?.name))
    );
  }

  async resolveConflict(
    toolId: string,
    preferredSource: string
  ): Promise<void> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`);
    }

    // Find duplicates
    const duplicates = await this.findDuplicates(tool);

    // Delete non-preferred sources
    for (const dup of duplicates) {
      if (dup.source !== preferredSource) {
        await this.deleteTool(dup.id);
      }
    }
  }

  async updateHealth(
    toolId: string,
    health: { status: HealthStatus; lastError?: string }
  ): Promise<void> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`);
    }

    tool.health = {
      status: health.status,
      lastError: health.lastError,
      ...(health.lastError && { lastErrorAt: new Date() }),
    };

    tool.lastHealthCheckAt = new Date();

    this.tools.set(toolId, tool);
  }

  async importFromMcp(
    serverName: string,
    tools: McpToolDefinition[]
  ): Promise<string[]> {
    const importedIds: string[] = [];

    for (const mcpTool of tools) {
      const toolId = `mcp:${serverName}.${mcpTool.name}`;

      const doc: ToolRegistryDocument = {
        id: toolId,
        canonicalName: `mcp_${serverName}_${mcpTool.name}`,
        description: mcpTool.description,
        source: 'mcp',
        sourceMetadata: {
          mcpServer: {
            name: serverName,
            version: '1.0.0',
          },
        },
        inputSchema: mcpTool.inputSchema,
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
        tags: ['mcp', serverName],
        relatedTools: [],
        importedAt: new Date(),
        lastUpdatedAt: new Date(),
      };

      await this.registerTool(doc);
      importedIds.push(toolId);
    }

    return importedIds;
  }

  async importFromBit(
    bitName: string,
    tools: BitBratTool[]
  ): Promise<string[]> {
    const importedIds: string[] = [];

    for (const bitTool of tools) {
      const toolId = `bit:${bitName}.${bitTool.id}`;

      const doc: ToolRegistryDocument = {
        id: toolId,
        canonicalName: bitTool.id,
        description: bitTool.description || '',
        source: bitTool.source,
        sourceMetadata: {
          bit: {
            name: bitName,
            version: '1.0.0',
          },
        },
        inputSchema: bitTool.inputSchema,
        rbac: {
          userRoles: {
            required: bitTool.requiredRoles || [],
            denied: [],
          },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
        config: {
          timeoutMs: 30000,
          retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
        },
        health: { status: 'healthy' },
        status: 'active',
        tags: ['bit', bitName, ...(bitTool.category ? [bitTool.category] : [])],
        relatedTools: [],
        importedAt: new Date(),
        lastUpdatedAt: new Date(),
      };

      await this.registerTool(doc);
      importedIds.push(toolId);
    }

    return importedIds;
  }
}

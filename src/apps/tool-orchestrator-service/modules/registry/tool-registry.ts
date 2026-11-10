/**
 * Tool Registry Module
 * Persistent PostgreSQL-backed tool storage with RBAC and health tracking
 * Sprint 57: Foundation - tool-orchestrator with Persistent Registries
 */

import { IDocumentStore, QueryFilter } from '../../../../common/persistence/interfaces';
import { Logger } from 'pino';
import {
  ToolRegistryDocument,
  ToolQueryFilters,
  HealthStatus,
  ToolSourceMetadata,
} from '../types';
import {
  IToolRegistry,
  McpToolDefinition,
  BitBratTool,
} from './interfaces';
import { randomUUID } from 'crypto';

const COLLECTION_NAME = 'platform_tool_registry';

/**
 * ToolRegistry implementation using PostgreSQL DocumentStore
 */
export class ToolRegistry implements IToolRegistry {
  constructor(
    private readonly store: IDocumentStore,
    private readonly logger: Logger
  ) {}

  /**
   * Register a new tool in the registry
   */
  async registerTool(tool: ToolRegistryDocument): Promise<void> {
    this.logger.debug({ toolId: tool.id, source: tool.source }, 'tool_registry.register_tool');

    // Check for duplicates before registering
    const duplicates = await this.findDuplicates(tool);
    if (duplicates.length > 0) {
      this.logger.warn({
        toolId: tool.id,
        canonicalName: tool.canonicalName,
        existingTools: duplicates.map((t) => t.id),
      }, 'tool_registry.duplicate_detected');
      throw new Error(
        `Tool with canonical name "${tool.canonicalName}" already exists. Use resolveConflict() to merge.`
      );
    }

    await this.store.set(COLLECTION_NAME, tool.id, tool);

    this.logger.info({
      toolId: tool.id,
      canonicalName: tool.canonicalName,
      source: tool.source,
    }, 'tool_registry.tool_registered');
  }

  /**
   * Get a tool by ID
   */
  async getTool(id: string): Promise<ToolRegistryDocument | null> {
    this.logger.debug({ toolId: id }, 'tool_registry.get_tool');
    return await this.store.get<ToolRegistryDocument>(COLLECTION_NAME, id);
  }

  /**
   * Query tools with filters
   */
  async queryTools(filters: ToolQueryFilters): Promise<ToolRegistryDocument[]> {
    this.logger.debug({ filters }, 'tool_registry.query_tools');

    const queryFilters: QueryFilter[] = [];

    if (filters.source && filters.source.length > 0) {
      queryFilters.push({
        field: 'source',
        operator: 'in',
        value: filters.source,
      });
    }

    if (filters.status && filters.status.length > 0) {
      queryFilters.push({
        field: 'status',
        operator: 'in',
        value: filters.status,
      });
    }

    if (filters.category) {
      queryFilters.push({
        field: 'category',
        operator: '==',
        value: filters.category,
      });
    }

    if (filters.tags && filters.tags.length > 0) {
      for (const tag of filters.tags) {
        queryFilters.push({
          field: 'tags',
          operator: 'array-contains',
          value: tag,
        });
      }
    }

    const tools = await this.store.query<ToolRegistryDocument>(COLLECTION_NAME, {
      filters: queryFilters.length > 0 ? queryFilters : undefined,
    });

    // Apply RBAC filtering if requested (post-query filtering for complex JSONB queries)
    let filteredTools = tools;
    if (filters.rbacFilter) {
      filteredTools = this.applyRbacFilter(tools, filters.rbacFilter);
    }

    this.logger.debug({
      totalFound: tools.length,
      afterRbacFilter: filteredTools.length,
    }, 'tool_registry.query_tools_result');

    return filteredTools;
  }

  /**
   * Update a tool's metadata
   */
  async updateTool(
    id: string,
    updates: Partial<ToolRegistryDocument>
  ): Promise<void> {
    this.logger.debug({ toolId: id, updates }, 'tool_registry.update_tool');

    const existing = await this.getTool(id);
    if (!existing) {
      throw new Error(`Tool not found: ${id}`);
    }

    // Update timestamp
    updates.lastUpdatedAt = new Date();

    await this.store.set(COLLECTION_NAME, id, updates, true); // merge=true

    this.logger.info({ toolId: id }, 'tool_registry.tool_updated');
  }

  /**
   * Delete a tool from the registry
   */
  async deleteTool(id: string): Promise<void> {
    this.logger.debug({ toolId: id }, 'tool_registry.delete_tool');
    await this.store.delete(COLLECTION_NAME, id);
    this.logger.info({ toolId: id }, 'tool_registry.tool_deleted');
  }

  /**
   * Find duplicate tools by canonical name
   */
  async findDuplicates(tool: ToolRegistryDocument): Promise<ToolRegistryDocument[]> {
    const allTools = await this.store.getAll<ToolRegistryDocument>(COLLECTION_NAME);
    return allTools.filter(
      (t) => t.canonicalName === tool.canonicalName && t.id !== tool.id
    );
  }

  /**
   * Resolve duplicate conflict by selecting preferred source
   */
  async resolveConflict(toolId: string, preferredSource: string): Promise<void> {
    this.logger.info({
      toolId,
      preferredSource,
    }, 'tool_registry.resolve_conflict');

    const tool = await this.getTool(toolId);
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`);
    }

    // Find duplicates
    const duplicates = await this.findDuplicates(tool);

    // Delete tools from non-preferred sources
    for (const duplicate of duplicates) {
      if (duplicate.source !== preferredSource) {
        await this.deleteTool(duplicate.id);
        this.logger.info({
          deletedToolId: duplicate.id,
          deletedSource: duplicate.source,
        }, 'tool_registry.conflict_resolved_deleted');
      }
    }

    // If current tool is not from preferred source, also delete it
    if (tool.source !== preferredSource) {
      await this.deleteTool(tool.id);
      this.logger.info({
        deletedToolId: tool.id,
        deletedSource: tool.source,
      }, 'tool_registry.conflict_resolved_deleted_original');
    }
  }

  /**
   * Update tool health status
   */
  async updateHealth(
    toolId: string,
    health: { status: HealthStatus; lastError?: string }
  ): Promise<void> {
    this.logger.debug({ toolId, health }, 'tool_registry.update_health');

    const tool = await this.getTool(toolId);
    if (!tool) {
      this.logger.warn({ toolId }, 'tool_registry.update_health_tool_not_found');
      return;
    }

    await this.updateTool(toolId, {
      health: {
        status: health.status,
        lastError: health.lastError,
        lastErrorAt: health.lastError ? new Date() : undefined,
        consecutiveFailures:
          health.status === 'healthy'
            ? 0
            : (tool.health.consecutiveFailures || 0) + 1,
      },
      lastHealthCheckAt: new Date(),
    });

    this.logger.info({
      toolId,
      status: health.status,
    }, 'tool_registry.health_updated');
  }

  /**
   * Import tools from MCP server
   */
  async importFromMcp(
    serverName: string,
    tools: McpToolDefinition[]
  ): Promise<string[]> {
    this.logger.info({
      serverName,
      toolCount: tools.length,
    }, 'tool_registry.import_from_mcp');

    const importedIds: string[] = [];

    for (const mcpTool of tools) {
      const toolDoc: ToolRegistryDocument = {
        id: `mcp.${serverName}.${mcpTool.name}`,
        canonicalName: mcpTool.name,
        description: mcpTool.description,
        source: 'mcp',
        sourceMetadata: {
          mcpServer: { name: serverName },
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

      try {
        // Check if tool already exists
        const existing = await this.getTool(toolDoc.id);
        if (existing) {
          // Update existing tool
          await this.updateTool(toolDoc.id, {
            description: toolDoc.description,
            inputSchema: toolDoc.inputSchema,
            lastUpdatedAt: new Date(),
          });
          this.logger.debug({
            toolId: toolDoc.id,
          }, 'tool_registry.import_mcp_updated');
        } else {
          // Register new tool
          await this.store.set(COLLECTION_NAME, toolDoc.id, toolDoc);
          this.logger.debug({
            toolId: toolDoc.id,
          }, 'tool_registry.import_mcp_registered');
        }
        importedIds.push(toolDoc.id);
      } catch (err) {
        this.logger.error({
          toolId: toolDoc.id,
          error: err instanceof Error ? err.message : String(err),
        }, 'tool_registry.import_mcp_failed');
      }
    }

    this.logger.info({
      serverName,
      imported: importedIds.length,
      total: tools.length,
    }, 'tool_registry.import_from_mcp_complete');

    return importedIds;
  }

  /**
   * Import tools from Bit service (tool-gateway)
   */
  async importFromBit(bitName: string, tools: BitBratTool[]): Promise<string[]> {
    this.logger.info({
      bitName,
      toolCount: tools.length,
    }, 'tool_registry.import_from_bit');

    const importedIds: string[] = [];

    for (const bitTool of tools) {
      const sourceMetadata: ToolSourceMetadata =
        bitTool.source === 'mcp' && bitTool.originServer
          ? { mcpServer: { name: bitTool.originServer } }
          : { bit: { name: bitName } };

      const toolDoc: ToolRegistryDocument = {
        id: bitTool.id,
        canonicalName: bitTool.displayName || bitTool.id,
        description: bitTool.description || '',
        source: bitTool.source,
        sourceMetadata,
        inputSchema: bitTool.inputSchema,
        rbac: {
          userRoles: {
            required: bitTool.requiredRoles || [],
            denied: [],
          },
          modelRoles: { required: [], denied: [] }, // Populated in Sprint 58
          modelTiers: { allowed: [], denied: [] },
        },
        config: {
          timeoutMs: 30000,
          retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
        },
        health: { status: 'healthy' },
        status: 'active',
        tags: bitTool.scopes || [],
        category: bitTool.category || 'general',
        relatedTools: [],
        importedAt: new Date(),
        lastUpdatedAt: new Date(),
      };

      try {
        // Check if tool already exists
        const existing = await this.getTool(toolDoc.id);
        if (existing) {
          // Update existing tool, preserve RBAC metadata
          await this.updateTool(toolDoc.id, {
            description: toolDoc.description,
            source: toolDoc.source,
            sourceMetadata: toolDoc.sourceMetadata,
            inputSchema: toolDoc.inputSchema,
            category: toolDoc.category,
            tags: toolDoc.tags,
            lastUpdatedAt: new Date(),
          });
          this.logger.debug({
            toolId: toolDoc.id,
          }, 'tool_registry.import_bit_updated');
        } else {
          // Register new tool
          await this.store.set(COLLECTION_NAME, toolDoc.id, toolDoc);
          this.logger.debug({
            toolId: toolDoc.id,
          }, 'tool_registry.import_bit_registered');
        }
        importedIds.push(toolDoc.id);
      } catch (err) {
        this.logger.error({
          toolId: toolDoc.id,
          error: err instanceof Error ? err.message : String(err),
        }, 'tool_registry.import_bit_failed');
      }
    }

    this.logger.info({
      bitName,
      imported: importedIds.length,
      total: tools.length,
    }, 'tool_registry.import_from_bit_complete');

    return importedIds;
  }

  /**
   * Apply RBAC filtering to tools (post-query)
   * This handles complex JSONB queries that aren't easily done in PostgreSQL
   */
  private applyRbacFilter(
    tools: ToolRegistryDocument[],
    rbacFilter: { userRoles?: string[]; modelId?: string }
  ): ToolRegistryDocument[] {
    return tools.filter((tool) => {
      // Filter by user roles
      if (rbacFilter.userRoles && rbacFilter.userRoles.length > 0) {
        const hasRequiredRoles =
          tool.rbac.userRoles.required.length === 0 ||
          tool.rbac.userRoles.required.some((role) =>
            rbacFilter.userRoles!.includes(role)
          );
        const hasDeniedRoles = tool.rbac.userRoles.denied.some((role) =>
          rbacFilter.userRoles!.includes(role)
        );

        if (!hasRequiredRoles || hasDeniedRoles) {
          return false;
        }
      }

      // Model-based filtering will be implemented in Sprint 58
      // For now, we only check if model roles are empty (Sprint 57)
      if (rbacFilter.modelId) {
        // Skip model RBAC filtering for now (Sprint 58)
        return true;
      }

      return true;
    });
  }
}

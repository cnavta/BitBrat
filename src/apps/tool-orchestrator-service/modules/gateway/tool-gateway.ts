/**
 * Tool Gateway - Central Tool Execution Orchestrator
 * Sprint 58: Model-Based RBAC - Dual-Layer Validation & Context Propagation
 *
 * Responsibilities:
 * - Tool execution orchestration
 * - Dual-layer RBAC validation (User × Model)
 * - MCP client management
 * - LRU cache (tool/model metadata, 5min TTL)
 * - Event logging to Loki
 * - Timeout enforcement
 */

import { ToolExecutionContext } from '../../../../types/tools';
import { IToolGateway, ToolResult } from './tool-gateway.interface';
import { RbacValidator, RBACValidationResult } from './rbac-validator';
import { IToolRegistry } from '../registry/interfaces';
import { IModelRegistry } from '../models/interfaces';
import { ToolRegistryDocument } from '../types/tool-registry-document';
import { ModelRegistryDocument } from '../types/model-registry-document';
import { McpClientManager } from '../../../../common/mcp/client-manager';

/**
 * LRU Cache Entry
 */
interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

/**
 * LRU Cache with TTL
 */
class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize: number = 1000, ttlMs: number = 300000) {
    // Default: 1000 entries, 5min TTL
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    // Remove if exists
    this.cache.delete(key);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    // Add new entry
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

/**
 * Tool Gateway Configuration
 */
export interface ToolGatewayConfig {
  defaultTimeoutMs?: number;
  cacheMaxSize?: number;
  cacheTtlMs?: number;
  enableLogging?: boolean;
}

/**
 * Tool Gateway Implementation
 */
export class ToolGateway implements IToolGateway {
  private toolRegistry: IToolRegistry;
  private modelRegistry: IModelRegistry;
  private rbacValidator: RbacValidator;
  private mcpClientManager?: McpClientManager;
  private toolCache: LRUCache<ToolRegistryDocument>;
  private modelCache: LRUCache<ModelRegistryDocument>;
  private config: Required<ToolGatewayConfig>;
  private logger?: any;

  constructor(
    toolRegistry: IToolRegistry,
    modelRegistry: IModelRegistry,
    config?: ToolGatewayConfig,
    mcpClientManager?: McpClientManager,
    logger?: any
  ) {
    this.toolRegistry = toolRegistry;
    this.modelRegistry = modelRegistry;
    this.rbacValidator = new RbacValidator();
    this.mcpClientManager = mcpClientManager;
    this.logger = logger;

    // Apply defaults
    this.config = {
      defaultTimeoutMs: config?.defaultTimeoutMs ?? 30000,
      cacheMaxSize: config?.cacheMaxSize ?? 1000,
      cacheTtlMs: config?.cacheTtlMs ?? 300000,
      enableLogging: config?.enableLogging ?? true,
    };

    // Initialize caches
    this.toolCache = new LRUCache<ToolRegistryDocument>(
      this.config.cacheMaxSize,
      this.config.cacheTtlMs
    );
    this.modelCache = new LRUCache<ModelRegistryDocument>(
      this.config.cacheMaxSize,
      this.config.cacheTtlMs
    );
  }

  /**
   * Execute a tool with dual-layer RBAC enforcement
   */
  async execute(
    toolId: string,
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // Step 1: Get tool from registry (with cache)
      const tool = await this.getToolCached(toolId);
      if (!tool) {
        this.logEvent('tool_not_found', { toolId, userId: context.userId, modelId: context.modelId }, true);
        throw new Error(`Tool not found: ${toolId}`);
      }

      // Step 2: Get model from registry (with cache)
      const model = await this.getModelCached(context.modelId);
      if (!model) {
        this.logEvent('model_not_found', { toolId, modelId: context.modelId }, true);
        throw new Error(`Model not found: ${context.modelId}`);
      }

      // Step 3: RBAC validation (dual-layer)
      const rbacResult = this.rbacValidator.validateToolAccess(
        tool,
        context.userRoles,
        model
      );

      if (!rbacResult.allowed) {
        this.logEvent('rbac_denied', {
          toolId,
          userId: context.userId,
          modelId: context.modelId,
          reason: rbacResult.reason,
          details: rbacResult.details,
        }, true);
        throw new Error(`Access denied: ${rbacResult.details || rbacResult.reason}`);
      }

      // Step 4: Route execution based on tool source
      let result: ToolResult;

      switch (tool.source) {
        case 'internal':
          result = await this.executeInternal(tool, args, context);
          break;

        case 'mcp':
          result = await this.executeMcp(tool, args, context);
          break;

        case 'composition':
          result = await this.executeComposition(tool, args, context);
          break;

        default:
          throw new Error(`Unknown tool source: ${tool.source}`);
      }

      // Step 5: Log success
      const duration = Date.now() - startTime;
      this.logEvent('tool_execution_success', {
        toolId,
        userId: context.userId,
        modelId: context.modelId,
        durationMs: duration,
      }, false);

      return result;
    } catch (error: any) {
      // Log error
      const duration = Date.now() - startTime;
      this.logEvent('tool_execution_error', {
        toolId,
        userId: context.userId,
        modelId: context.modelId,
        error: error.message,
        durationMs: duration,
      }, true);

      throw error;
    }
  }

  /**
   * Validate tool access for a user and model
   */
  async validateToolAccess(
    toolId: string,
    userId: string,
    modelId: string,
    userRoles: string[]
  ): Promise<RBACValidationResult> {
    // Get tool and model from cache/registry
    const tool = await this.getToolCached(toolId);
    if (!tool) {
      return {
        allowed: false,
        reason: 'tool_not_found',
        details: `Tool not found: ${toolId}`,
      };
    }

    const model = await this.getModelCached(modelId);
    if (!model) {
      return {
        allowed: false,
        reason: 'model_not_found',
        details: `Model not found: ${modelId}`,
      };
    }

    // Validate with RbacValidator
    return this.rbacValidator.validateToolAccess(tool, userRoles, model);
  }

  /**
   * List tools available to a user and model
   */
  async listAvailableTools(
    userId: string,
    modelId: string,
    userRoles: string[]
  ): Promise<string[]> {
    // Get model
    const model = await this.getModelCached(modelId);
    if (!model) {
      return [];
    }

    // Query all active tools
    const tools = await this.toolRegistry.queryTools({
      status: ['active'],
    });

    // Filter by RBAC
    const availableTools: string[] = [];

    for (const tool of tools) {
      const rbacResult = this.rbacValidator.validateToolAccess(
        tool,
        userRoles,
        model
      );

      if (rbacResult.allowed) {
        availableTools.push(tool.id);
      }
    }

    return availableTools;
  }

  /**
   * Ensure MCP client connection
   */
  async ensureMcpClient(serverId: string): Promise<void> {
    if (!this.mcpClientManager) {
      throw new Error('MCP client manager not configured');
    }

    // McpClientManager handles connection lifecycle
    // This is a no-op if already connected
    this.logger?.debug('tool_gateway.ensure_mcp_client', { serverId });
  }

  /**
   * Disconnect MCP client
   */
  async disconnectMcpClient(serverId: string): Promise<void> {
    if (!this.mcpClientManager) {
      throw new Error('MCP client manager not configured');
    }

    this.logger?.debug('tool_gateway.disconnect_mcp_client', { serverId });
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Get tool from cache or registry
   */
  private async getToolCached(toolId: string): Promise<ToolRegistryDocument | null> {
    // Check cache
    const cached = this.toolCache.get(toolId);
    if (cached) {
      return cached;
    }

    // Fetch from registry
    const tool = await this.toolRegistry.getTool(toolId);
    if (tool) {
      this.toolCache.set(toolId, tool);
    }

    return tool;
  }

  /**
   * Get model from cache or registry
   */
  private async getModelCached(modelId: string): Promise<ModelRegistryDocument | null> {
    // Check cache
    const cached = this.modelCache.get(modelId);
    if (cached) {
      return cached;
    }

    // Fetch from registry
    const model = await this.modelRegistry.getModel(modelId);
    if (model) {
      this.modelCache.set(modelId, model);
    }

    return model;
  }

  /**
   * Execute internal (platform-provided) tool
   */
  private async executeInternal(
    tool: ToolRegistryDocument,
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    // Internal tools are executed directly via tool registry
    // This is a placeholder - actual implementation depends on internal tool execution mechanism
    this.logger?.debug('tool_gateway.execute_internal', { toolId: tool.id });

    // Timeout enforcement
    const timeout = tool.config.timeoutMs || this.config.defaultTimeoutMs;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Tool execution timeout: ${timeout}ms`)), timeout);
    });

    // Execute with timeout
    const executionPromise = this.executeInternalUnsafe(tool, args, context);

    const result = await Promise.race([executionPromise, timeoutPromise]);
    return result;
  }

  /**
   * Execute internal tool (without timeout wrapper)
   */
  private async executeInternalUnsafe(
    tool: ToolRegistryDocument,
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    // Placeholder: Actual execution delegated to internal tool handlers
    // In real implementation, this would invoke the tool via internal registry
    throw new Error('Internal tool execution not yet implemented');
  }

  /**
   * Execute MCP (external) tool
   *
   * NOTE: Sprint 58 placeholder - full MCP execution requires client lookup
   * and ProxyInvoker integration which is outside this sprint's scope.
   * The interface and RBAC validation are the primary deliverables.
   */
  private async executeMcp(
    tool: ToolRegistryDocument,
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    if (!this.mcpClientManager) {
      throw new Error('MCP client manager not configured');
    }

    this.logger?.debug('tool_gateway.execute_mcp', { toolId: tool.id });

    // Get MCP server name from tool metadata
    const serverName = tool.sourceMetadata.mcpServer?.name;
    if (!serverName) {
      throw new Error(`MCP tool missing server name: ${tool.id}`);
    }

    // Placeholder: Full integration requires client lookup and ProxyInvoker
    // This will be completed when integrating with the existing tool-gateway
    throw new Error('MCP tool execution not yet implemented - Sprint 58 focuses on RBAC validation');
  }

  /**
   * Execute composition (multi-tool) tool
   */
  private async executeComposition(
    tool: ToolRegistryDocument,
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    this.logger?.debug('tool_gateway.execute_composition', { toolId: tool.id });

    // Get composition metadata
    const composition = tool.sourceMetadata.composition;
    if (!composition) {
      throw new Error(`Composition tool missing metadata: ${tool.id}`);
    }

    // Execute based on strategy
    switch (composition.strategy) {
      case 'sequential':
        return await this.executeSequential(composition.toolIds, args, context);

      case 'parallel':
        return await this.executeParallel(composition.toolIds, args, context);

      case 'conditional':
        return await this.executeConditional(composition.toolIds, args, context);

      default:
        throw new Error(`Unknown composition strategy: ${composition.strategy}`);
    }
  }

  /**
   * Execute tools sequentially
   */
  private async executeSequential(
    toolIds: string[],
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const results: ToolResult[] = [];

    for (const toolId of toolIds) {
      const result = await this.execute(toolId, args, context);
      results.push(result);
    }

    // Combine results
    return {
      content: results.flatMap((r) => r.content),
      isError: results.some((r) => r.isError),
    };
  }

  /**
   * Execute tools in parallel
   */
  private async executeParallel(
    toolIds: string[],
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const results = await Promise.all(
      toolIds.map((toolId) => this.execute(toolId, args, context))
    );

    // Combine results
    return {
      content: results.flatMap((r) => r.content),
      isError: results.some((r) => r.isError),
    };
  }

  /**
   * Execute tools conditionally
   */
  private async executeConditional(
    toolIds: string[],
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    // Placeholder: Conditional execution logic
    // In real implementation, this would evaluate conditions and execute accordingly
    throw new Error('Conditional composition not yet implemented');
  }

  /**
   * Log event to Loki (structured logging)
   */
  private logEvent(event: string, data: Record<string, any>, isError: boolean): void {
    if (!this.config.enableLogging) return;

    const logData = {
      event: `tool_gateway.${event}`,
      timestamp: new Date().toISOString(),
      ...data,
    };

    if (isError) {
      this.logger?.error(logData);
    } else {
      this.logger?.info(logData);
    }
  }

  /**
   * Clear caches (for testing)
   */
  clearCaches(): void {
    this.toolCache.clear();
    this.modelCache.clear();
  }

  /**
   * Get cache statistics (for monitoring)
   */
  getCacheStats(): {
    toolCacheSize: number;
    modelCacheSize: number;
  } {
    return {
      toolCacheSize: this.toolCache.size(),
      modelCacheSize: this.modelCache.size(),
    };
  }
}

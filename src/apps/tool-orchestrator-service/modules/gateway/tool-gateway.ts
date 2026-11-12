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
import { normalizeError } from '../../../../common/mcp/error-utils';
import {
  createToolInvocationEvent,
  truncatePreview,
  ToolInvocationEvent,
} from '../../types/tool-invocation-event';
import { z } from 'zod';

/**
 * Schema for agent.sendProgressUpdate tool.
 * Allows agents to send progress messages to users before long-running operations.
 * Sprint 60: Migrated from tool-gateway.ts
 */
const SendProgressUpdateSchema = z.object({
  message: z.string().describe('Progress message to send to the user (1-200 characters)'),
  emoji: z.string().optional().describe('Optional emoji to prepend to the message (default: 🔄)'),
  urgency: z.enum(['low', 'normal', 'high']).optional().describe('Message urgency level (default: normal)'),
});

type SendProgressUpdateArgs = z.infer<typeof SendProgressUpdateSchema>;

/**
 * Internal Tool Handler Function Type
 */
type InternalToolHandler = (
  args: unknown,
  context: ToolExecutionContext
) => Promise<ToolResult>;

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
  private internalTools: Map<string, InternalToolHandler>;

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

    // Initialize internal tools registry (Sprint 60: T2.2)
    this.internalTools = new Map();
    this.registerInternalTools();
  }

  /**
   * Register built-in internal tools
   * Sprint 60: T2.2 - Internal tool execution
   */
  private registerInternalTools(): void {
    // Register agent.sendProgressUpdate
    this.internalTools.set('agent.sendProgressUpdate', this.handleSendProgressUpdate.bind(this));

    this.logger?.info('tool_gateway.internal_tools.registered', {
      tools: Array.from(this.internalTools.keys()),
      count: this.internalTools.size
    });
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
        const duration = Date.now() - startTime;

        // Log structured invocation event (status: denied)
        this.logToolInvocationEvent({
          tool,
          model,
          status: 'denied',
          durationMs: duration,
          context,
          rbacResult,
          args,
        });

        // Log legacy event (for backward compatibility)
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

      // Log structured invocation event (status: success)
      this.logToolInvocationEvent({
        tool,
        model,
        status: 'success',
        durationMs: duration,
        context,
        rbacResult,
        args,
        result,
      });

      // Log legacy event (for backward compatibility)
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

      // Try to get tool/model for structured logging (may not be available if error occurred early)
      const tool = await this.getToolCached(toolId).catch(() => undefined);
      const model = await this.getModelCached(context.modelId).catch(() => undefined);

      // Log structured invocation event (status: error) if we have tool/model
      if (tool && model) {
        // Create a simple RBAC result (error case - validation not reached or failed)
        const rbacResult: RBACValidationResult = {
          allowed: false,
          reason: 'execution_failed',
          details: error.message,
        };

        this.logToolInvocationEvent({
          tool,
          model,
          status: 'error',
          durationMs: duration,
          context,
          rbacResult,
          args,
          error,
        });
      }

      // Log legacy event (for backward compatibility)
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
   * Sprint 60: T5.2 - Detect transient errors that should be retried
   */
  private isTransientError(error: any): boolean {
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code?.toLowerCase() || '';

    // Network errors
    const networkErrors = [
      'econnrefused',
      'econnreset',
      'etimedout',
      'enotfound',
      'enetunreach',
      'socket hang up',
      'network error'
    ];

    // Timeout errors
    const timeoutErrors = [
      'timeout',
      'timed out',
      'aborted'
    ];

    // Server errors (5xx)
    const serverErrors = [
      'server error',
      'internal server error',
      '503',
      '502',
      '504'
    ];

    // Check if error matches any transient pattern
    return (
      networkErrors.some(pattern => errorCode.includes(pattern) || errorMessage.includes(pattern)) ||
      timeoutErrors.some(pattern => errorMessage.includes(pattern)) ||
      serverErrors.some(pattern => errorMessage.includes(pattern))
    );
  }

  /**
   * Sprint 60: T5.2 - Execute function with retry logic and exponential backoff
   *
   * Retries transient errors (network, timeout, server 5xx) with exponential backoff.
   * Does NOT retry non-transient errors (RBAC denial, validation errors).
   *
   * @param fn - Function to execute
   * @param retryPolicy - Retry configuration (maxAttempts, backoffMs)
   * @param context - Execution context for logging
   * @returns Result of function execution
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    retryPolicy: { maxAttempts: number; backoffMs: number },
    context: { toolId: string; correlationId?: string }
  ): Promise<T> {
    const maxAttempts = retryPolicy.maxAttempts || 3;
    const baseBackoffMs = retryPolicy.backoffMs || 1000;

    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await fn();

        // Log retry success if this wasn't the first attempt
        if (attempt > 1) {
          this.logger?.info('tool_gateway.retry.success', {
            toolId: context.toolId,
            attempt,
            correlationId: context.correlationId
          });
        }

        return result;

      } catch (error: any) {
        lastError = error;

        // Check if error is transient
        const isTransient = this.isTransientError(error);

        this.logger?.warn('tool_gateway.retry.attempt_failed', {
          toolId: context.toolId,
          attempt,
          maxAttempts,
          isTransient,
          error: error.message,
          correlationId: context.correlationId
        });

        // Don't retry non-transient errors
        if (!isTransient) {
          this.logger?.error('tool_gateway.retry.non_transient_error', {
            toolId: context.toolId,
            attempt,
            error: error.message,
            correlationId: context.correlationId
          });
          throw error;
        }

        // Don't retry if we've exhausted all attempts
        if (attempt >= maxAttempts) {
          this.logger?.error('tool_gateway.retry.max_attempts_exceeded', {
            toolId: context.toolId,
            attempts: attempt,
            error: error.message,
            correlationId: context.correlationId
          });
          break;
        }

        // Calculate exponential backoff: 2^(attempt-1) * baseBackoffMs
        // attempt=1: 1s, attempt=2: 2s, attempt=3: 4s
        const backoffMs = Math.pow(2, attempt - 1) * baseBackoffMs;

        this.logger?.debug('tool_gateway.retry.backoff', {
          toolId: context.toolId,
          attempt,
          backoffMs,
          nextAttempt: attempt + 1,
          correlationId: context.correlationId
        });

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }

    // All retries exhausted, throw the last error
    throw lastError;
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
   * Sprint 60: T2.2 - Full implementation with internal tool registry
   */
  private async executeInternalUnsafe(
    tool: ToolRegistryDocument,
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    this.logger?.debug('tool_gateway.execute_internal_unsafe.start', {
      toolId: tool.id,
      canonicalName: tool.canonicalName,
      correlationId: context.correlationId
    });

    // Get handler from internal tools registry
    const handler = this.internalTools.get(tool.id);
    if (!handler) {
      this.logger?.error('tool_gateway.execute_internal_unsafe.handler_not_found', {
        toolId: tool.id,
        availableTools: Array.from(this.internalTools.keys()),
        correlationId: context.correlationId
      });
      throw new Error(`Internal tool handler not found: ${tool.id}`);
    }

    // Execute handler with context
    try {
      const result = await handler(args, context);

      this.logger?.debug('tool_gateway.execute_internal_unsafe.success', {
        toolId: tool.id,
        hasContent: result.content?.length > 0,
        correlationId: context.correlationId
      });

      return result;
    } catch (error: any) {
      this.logger?.error('tool_gateway.execute_internal_unsafe.error', {
        toolId: tool.id,
        error: error.message,
        correlationId: context.correlationId
      });
      throw error;
    }
  }

  /**
   * Handle agent.sendProgressUpdate tool invocation
   * Sprint 60: T2.2 - Migrated from tool-gateway.ts
   *
   * Creates a simple success message indicating the progress update would be sent.
   * In production, this would integrate with the event bus and feedback middleware.
   */
  private async handleSendProgressUpdate(
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    // Validate args against schema
    const validatedArgs = SendProgressUpdateSchema.parse(args) as SendProgressUpdateArgs;

    this.logger?.debug('tool_gateway.send_progress_update.invoked', {
      sessionId: context.sessionId,
      correlationId: context.correlationId,
      messageLength: validatedArgs.message.length,
      emoji: validatedArgs.emoji,
      urgency: validatedArgs.urgency,
      userId: context.userId
    });

    // Build progress message
    const emoji = validatedArgs.emoji || '🔄';
    const progressMessage = `${emoji} ${validatedArgs.message}`;

    // In production, this would:
    // 1. Retrieve original event from claim check using correlationId
    // 2. Create progress event with candidates[]
    // 3. Route via Bit.next() for delivery
    // For now, return success acknowledgment

    this.logger?.info('tool_gateway.send_progress_update.success', {
      sessionId: context.sessionId,
      correlationId: context.correlationId,
      message: progressMessage,
      urgency: validatedArgs.urgency || 'normal'
    });

    return {
      content: [{
        type: 'text',
        text: `Progress update acknowledged: "${progressMessage}"`
      }],
      isError: false
    };
  }

  /**
   * Execute MCP (external) tool
   * Sprint 60: Full MCP execution with timeout enforcement and result transformation
   */
  private async executeMcp(
    tool: ToolRegistryDocument,
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    if (!this.mcpClientManager) {
      throw new Error('MCP client manager not configured');
    }

    this.logger?.debug('tool_gateway.execute_mcp.start', {
      toolId: tool.id,
      canonicalName: tool.canonicalName,
      correlationId: context.correlationId
    });

    // Get MCP server name from tool metadata
    const serverName = tool.sourceMetadata.mcpServer?.name;
    if (!serverName) {
      throw new Error(`MCP tool missing server name: ${tool.id}`);
    }

    // Get timeout from tool config or use default
    const timeout = tool.config.timeoutMs || this.config.defaultTimeoutMs;

    // Sprint 60: T5.2 - Wrap MCP call with retry logic
    const retryPolicy = tool.config.retryPolicy || { maxAttempts: 3, backoffMs: 1000 };

    // Create AbortController for timeout enforcement
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
      controller.abort();
      this.logger?.warn('tool_gateway.execute_mcp.timeout', {
        toolId: tool.id,
        serverName,
        timeoutMs: timeout,
        correlationId: context.correlationId
      });
    }, timeout);

    try {
      // Execute MCP call with retry logic
      const result = await this.executeWithRetry(
        async () => {
          // Get MCP client for this server
          const client = this.mcpClientManager!.getClient(serverName);
          if (!client) {
            throw new Error(`MCP client not found for server: ${serverName}`);
          }

          // Call MCP tool with context metadata
          return await client.callTool({
            name: tool.canonicalName,
            arguments: args,
            _meta: {
              userRoles: context.userRoles,
              userId: context.userId,
              correlationId: context.correlationId,
              sessionId: context.sessionId,
            }
          } as any);
        },
        retryPolicy,
        { toolId: tool.id, correlationId: context.correlationId }
      );

      // Check for errors in result
      if (result.isError) {
        this.logger?.error('tool_gateway.execute_mcp.error_result', {
          toolId: tool.id,
          serverName,
          content: result.content,
          correlationId: context.correlationId
        });
        throw new Error(`MCP Tool Error: ${JSON.stringify(result.content)}`);
      }

      // Extract text content from result
      const content = result.content as any[];
      const textParts = content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text);

      if (textParts.length > 0) {
        const response = textParts.join('\n').trim();
        if (response.length > 0) {
          this.logger?.debug('tool_gateway.execute_mcp.success', {
            toolId: tool.id,
            serverName,
            responseLength: response.length,
            correlationId: context.correlationId
          });

          return {
            content: [{ type: 'text', text: response }],
            isError: false
          };
        }
      }

      // Fallback to full content if no text parts
      this.logger?.debug('tool_gateway.execute_mcp.success_fallback', {
        toolId: tool.id,
        serverName,
        contentTypes: content.map((c: any) => c.type),
        correlationId: context.correlationId
      });

      // Map MCP content to ToolResult format (extract only relevant fields)
      const mappedContent = content.map((c: any) => ({
        type: c.type,
        text: c.text,
        data: c.data,
        mimeType: c.mimeType
      }));

      return {
        content: mappedContent,
        isError: false
      };

    } catch (error: any) {
      this.logger?.error('tool_gateway.execute_mcp.error', {
        toolId: tool.id,
        serverName,
        error: error.message,
        correlationId: context.correlationId
      });

      // Normalize nested MCP error messages
      throw normalizeError(error);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * Execute composition (multi-tool) tool
   * Sprint 60: T3.2 + T3.3 - Composition execution with per-step RBAC validation
   */
  private async executeComposition(
    tool: ToolRegistryDocument,
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    this.logger?.debug('tool_gateway.execute_composition.start', {
      toolId: tool.id,
      correlationId: context.correlationId
    });

    // Get composition metadata
    const composition = tool.sourceMetadata.composition;
    if (!composition) {
      this.logger?.error('tool_gateway.execute_composition.missing_metadata', {
        toolId: tool.id,
        correlationId: context.correlationId
      });
      throw new Error(`Composition tool missing metadata: ${tool.id}`);
    }

    // Extract constituent tool IDs
    const constituentToolIds = composition.toolIds || [];
    if (constituentToolIds.length === 0) {
      this.logger?.warn('tool_gateway.execute_composition.no_constituent_tools', {
        toolId: tool.id,
        correlationId: context.correlationId
      });
      throw new Error(`Composition has no constituent tools: ${tool.id}`);
    }

    // T3.3: Validate RBAC for EACH constituent tool (prevent privilege escalation)
    this.logger?.debug('tool_gateway.execute_composition.rbac_validation_start', {
      toolId: tool.id,
      constituentToolIds,
      modelId: context.modelId,
      correlationId: context.correlationId
    });

    for (const constituentToolId of constituentToolIds) {
      const rbacResult = await this.validateToolAccess(
        constituentToolId,
        context.userId || 'anonymous',
        context.modelId,  // Validate against INVOKING model, not registering model
        context.userRoles
      );

      if (!rbacResult.allowed) {
        this.logger?.warn('tool_gateway.execute_composition.rbac_denied', {
          toolId: tool.id,
          constituentToolId,
          modelId: context.modelId,
          reason: rbacResult.reason,
          details: rbacResult.details,
          correlationId: context.correlationId
        });

        // Log RBAC denial for audit trail
        this.logEvent('tool_gateway.composition_rbac_denied', {
          compositionId: tool.id,
          constituentToolId,
          userId: context.userId,
          modelId: context.modelId,
          reason: rbacResult.reason,
          details: rbacResult.details,
        }, true);

        throw new Error(
          `Composition denied: constituent tool "${constituentToolId}" not allowed for model ${context.modelId}. Reason: ${rbacResult.reason}`
        );
      }
    }

    this.logger?.debug('tool_gateway.execute_composition.rbac_validation_passed', {
      toolId: tool.id,
      constituentToolsValidated: constituentToolIds.length,
      correlationId: context.correlationId
    });

    // Execute based on strategy
    const startTime = Date.now();
    let result: ToolResult;

    try {
      switch (composition.strategy) {
        case 'sequential':
          result = await this.executeSequential(composition.toolIds, args, context);
          break;

        case 'parallel':
          result = await this.executeParallel(composition.toolIds, args, context);
          break;

        case 'conditional':
          result = await this.executeConditional(composition.toolIds, args, context);
          break;

        default:
          throw new Error(`Unknown composition strategy: ${composition.strategy}`);
      }

      const duration = Date.now() - startTime;

      this.logger?.info('tool_gateway.execute_composition.success', {
        toolId: tool.id,
        strategy: composition.strategy,
        stepsExecuted: constituentToolIds.length,
        durationMs: duration,
        correlationId: context.correlationId
      });

      return result;

    } catch (error: any) {
      const duration = Date.now() - startTime;

      this.logger?.error('tool_gateway.execute_composition.error', {
        toolId: tool.id,
        strategy: composition.strategy,
        error: error.message,
        durationMs: duration,
        correlationId: context.correlationId
      });

      throw error;
    }
  }

  /**
   * Execute tools sequentially
   * Sprint 60: T5.3 - Enhanced with graceful error handling
   */
  private async executeSequential(
    toolIds: string[],
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const results: ToolResult[] = [];
    let stepIndex = 0;

    for (const toolId of toolIds) {
      stepIndex++;

      try {
        this.logger?.debug('tool_gateway.execute_sequential.step_start', {
          toolId,
          stepIndex,
          totalSteps: toolIds.length,
          correlationId: context.correlationId
        });

        const result = await this.execute(toolId, args, context);
        results.push(result);

        this.logger?.debug('tool_gateway.execute_sequential.step_success', {
          toolId,
          stepIndex,
          correlationId: context.correlationId
        });

      } catch (error: any) {
        this.logger?.error('tool_gateway.execute_sequential.step_failed', {
          toolId,
          stepIndex,
          totalSteps: toolIds.length,
          error: error.message,
          completedSteps: stepIndex - 1,
          correlationId: context.correlationId
        });

        // Return error result with context about where it failed
        return {
          content: [
            {
              type: 'text',
              text: `Sequential composition failed at step ${stepIndex}/${toolIds.length} (tool: ${toolId}): ${error.message}`
            }
          ],
          isError: true
        };
      }
    }

    // All steps completed successfully
    this.logger?.info('tool_gateway.execute_sequential.all_steps_complete', {
      totalSteps: toolIds.length,
      correlationId: context.correlationId
    });

    // Combine results
    return {
      content: results.flatMap((r) => r.content),
      isError: results.some((r) => r.isError),
    };
  }

  /**
   * Execute tools in parallel
   * Sprint 60: T5.3 - Enhanced with graceful partial failure handling
   */
  private async executeParallel(
    toolIds: string[],
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    this.logger?.debug('tool_gateway.execute_parallel.start', {
      toolIds,
      totalSteps: toolIds.length,
      correlationId: context.correlationId
    });

    // Use Promise.allSettled to capture both successes and failures
    const settledResults = await Promise.allSettled(
      toolIds.map((toolId, index) =>
        this.execute(toolId, args, context).then(
          (result) => {
            this.logger?.debug('tool_gateway.execute_parallel.step_success', {
              toolId,
              stepIndex: index + 1,
              correlationId: context.correlationId
            });
            return { toolId, result };
          },
          (error) => {
            this.logger?.error('tool_gateway.execute_parallel.step_failed', {
              toolId,
              stepIndex: index + 1,
              error: error.message,
              correlationId: context.correlationId
            });
            throw error;
          }
        )
      )
    );

    // Separate successes and failures
    const successes: ToolResult[] = [];
    const failures: { toolId: string; error: string }[] = [];

    settledResults.forEach((settled, index) => {
      if (settled.status === 'fulfilled') {
        successes.push(settled.value.result);
      } else {
        failures.push({
          toolId: toolIds[index],
          error: settled.reason?.message || String(settled.reason)
        });
      }
    });

    // Log summary
    this.logger?.info('tool_gateway.execute_parallel.complete', {
      totalSteps: toolIds.length,
      successes: successes.length,
      failures: failures.length,
      correlationId: context.correlationId
    });

    // If any failures, return error result with details
    if (failures.length > 0) {
      const failureDetails = failures
        .map((f) => `- ${f.toolId}: ${f.error}`)
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Parallel composition had ${failures.length}/${toolIds.length} failures:\n${failureDetails}`
          }
        ],
        isError: true
      };
    }

    // All steps succeeded - combine results
    return {
      content: successes.flatMap((r) => r.content),
      isError: successes.some((r) => r.isError),
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
   * Log structured tool invocation event for observability (Sprint 59)
   *
   * Emits a ToolInvocationEvent to stdout, which is:
   * - Scraped by Promtail
   * - Indexed by Loki (labels: service, eventType, toolId, modelId, status, correlationId, level)
   * - Queryable via ToolObserver for metrics, health, and tracing
   *
   * Logging is fire-and-forget (asynchronous, non-blocking).
   */
  private logToolInvocationEvent(params: {
    tool: ToolRegistryDocument;
    model: ModelRegistryDocument;
    status: 'success' | 'error' | 'denied';
    durationMs: number;
    context: ToolExecutionContext;
    rbacResult: RBACValidationResult;
    args?: unknown;
    result?: ToolResult;
    error?: Error;
  }): void {
    if (!this.config.enableLogging) return;

    try {
      // Truncate input/output previews
      const inputPreview = params.args
        ? truncatePreview(JSON.stringify(params.args), 500)
        : undefined;

      const outputPreview = params.result
        ? truncatePreview(JSON.stringify(params.result), 500)
        : undefined;

      // Estimate cost (if available from model metadata)
      let estimatedCost: ToolInvocationEvent['estimatedCost'] | undefined;
      if (params.model.cost && params.result) {
        // Simple token estimation based on input/output length
        const inputTokens = inputPreview ? Math.ceil(inputPreview.length / 4) : 0;
        const outputTokens = outputPreview ? Math.ceil(outputPreview.length / 4) : 0;
        const totalTokens = inputTokens + outputTokens;

        // Calculate cost (ModelCost has inputTokenCost and outputTokenCost per 1M tokens)
        const inputCost = (inputTokens / 1000000) * (params.model.cost.inputTokenCost || 0);
        const outputCost = (outputTokens / 1000000) * (params.model.cost.outputTokenCost || 0);

        estimatedCost = {
          tokens: totalTokens,
          costUsd: inputCost + outputCost,
        };
      }

      // Create the event
      const event = createToolInvocationEvent({
        toolId: params.tool.id,
        toolName: params.tool.canonicalName, // Use canonicalName
        modelId: params.model.id,
        modelName: params.model.displayName, // Use displayName
        status: params.status,
        correlationId: params.context.correlationId || 'unknown',
        durationMs: params.durationMs,
        rbacDecision: {
          allowed: params.rbacResult.allowed,
          reason: params.rbacResult.reason,
          userRoles: params.context.userRoles,
          modelTier: params.model.tier,
          requiredRoles: params.tool.rbac?.userRoles?.required,
          deniedRoles: params.tool.rbac?.userRoles?.denied,
        },
        userId: params.context.userId,
        sessionId: params.context.sessionId,
        traceId: undefined, // ToolExecutionContext doesn't have traceId
        inputPreview,
        outputPreview,
        errorMessage: params.error?.message,
        errorStack: process.env.NODE_ENV !== 'production' ? params.error?.stack : undefined,
        estimatedCost,
      });

      // Log as JSON to stdout (Promtail will scrape and send to Loki)
      // Use logger.info for success/denied, logger.error for errors
      if (params.status === 'error') {
        this.logger?.error(event);
      } else {
        this.logger?.info(event);
      }
    } catch (loggingError) {
      // Fail-open: Logging errors should never block tool execution
      this.logger?.warn(
        { error: (loggingError as Error).message },
        'tool_invocation_event.logging_failed'
      );
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

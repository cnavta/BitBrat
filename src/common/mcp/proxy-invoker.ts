import { ReadResourceResultSchema, GetPromptResultSchema } from "@modelcontextprotocol/core";
import { Client, CallToolResult, ReadResourceResult, GetPromptResult } from "@modelcontextprotocol/client";
import { ToolExecutionContext } from '../../types/tools';
import { McpObservability } from './observability';

export interface ProxyInvokerOptions {
  /**
   * Maximum time (in ms) to wait for a tool invocation to complete.
   * Default: 60000 (60 seconds)
   */
  timeoutMs?: number;
  /**
   * Number of consecutive failures before opening the circuit for a server.
   * Default: 5
   */
  failureThreshold?: number;
  /**
   * Time (in ms) to wait after opening a circuit before attempting to half-open.
   * Default: 30000 (30 seconds)
   */
  resetTimeoutMs?: number;
  /**
   * Optional logger for recording timeout and circuit breaker events.
   */
  logger?: any;
}

export interface CircuitState {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  consecutiveFailures: number;
  lastFailureAt?: number;
}

/**
 * ProxyInvoker
 * - Wraps MCP client calls with timeout and circuit breaking logic.
 * - Tracks health of upstream MCP servers per server name.
 */
export class ProxyInvoker {
  private circuitBreakers: Map<string, CircuitState> = new Map();

  constructor(private options: ProxyInvokerOptions = {}) {
    this.options.timeoutMs = this.options.timeoutMs || 60000;
    this.options.failureThreshold = this.options.failureThreshold || 5;
    this.options.resetTimeoutMs = this.options.resetTimeoutMs || 30000;
  }

  /**
   * Invokes a tool on an upstream MCP server with resilience patterns.
   */
  async invoke(serverName: string, toolName: string, args: any, client: Client, context?: ToolExecutionContext, optionsOverride?: ProxyInvokerOptions): Promise<CallToolResult> {
    const start = Date.now();
    try {
      const result = await this.wrapCall(serverName, `tool:${toolName}`, () => {
        // Sprint 65 FIX: Pass _meta BOTH ways:
        // 1. As top-level field (for MCP protocol/transport)
        // 2. Merged into arguments (for server-side access via args._meta)
        // The MCP SDK may not automatically merge top-level _meta into the arguments object
        // that the server receives, so we explicitly do both.

        // HOTFIX 5: Build _meta conditionally - don't include undefined modelId
        const meta: any = context ? {
          userRoles: context.userRoles,
          userId: context.userId,
          correlationId: context.correlationId,
          sessionId: context.sessionId,
        } : undefined;

        // Only include modelId if it exists (don't send undefined)
        if (context?.modelId) {
          meta.modelId = context.modelId;
        }

        // Sprint 65 DEBUG: Log what we're sending to the upstream MCP server
        const logger = this.options.logger;
        logger?.debug?.('mcp.proxy_invoker.sending_request', {
          serverName,
          toolName,
          hasContext: !!context,
          hasMeta: !!meta,
          metaUserId: meta?.userId,
          metaModelId: meta?.modelId,
          metaRoles: meta?.userRoles,
          metaCorrelationId: meta?.correlationId,
        });

        // Sprint 65 FIX: Pass _meta ONLY as top-level field, NOT in arguments
        // The MCP SDK strips _meta from arguments when it's also at top-level.
        // We need to access _meta from ctx in the tool handler instead.
        return client.callTool({
          name: toolName,
          arguments: args,  // Do NOT include _meta in arguments
          _meta: meta,      // ONLY pass as top-level field
        } as any);
      },
        optionsOverride,
        context
      );
      void McpObservability.recordCall(serverName, toolName, Date.now() - start, false, context);
      return result as CallToolResult;
    } catch (error) {
      void McpObservability.recordCall(serverName, toolName, Date.now() - start, true, context, error);
      throw error;
    }
  }

  /**
   * Reads a resource from an upstream MCP server with resilience patterns.
   */
  async invokeResource(serverName: string, uri: string, client: Client, context?: ToolExecutionContext, optionsOverride?: ProxyInvokerOptions): Promise<ReadResourceResult> {
    const start = Date.now();
    try {
      const result = await this.wrapCall(serverName, `resource:${uri}`, () => {
        // Sprint 65 FIX: Include _meta in readResource call
        // Note: Resources use uri parameter, not arguments, so _meta is passed separately

        // HOTFIX 5: Build _meta conditionally - don't include undefined modelId
        const meta: any = context ? {
          userRoles: context.userRoles,
          userId: context.userId,
          correlationId: context.correlationId,
          sessionId: context.sessionId,
        } : undefined;

        // Only include modelId if it exists (don't send undefined)
        if (context?.modelId) {
          meta.modelId = context.modelId;
        }

        return client.readResource({
          uri,
          _meta: meta,
        } as any);
      },
        optionsOverride,
        context
      );
      void McpObservability.recordCall(serverName, `resource:${uri}`, Date.now() - start, false, context);
      return result as ReadResourceResult;
    } catch (error) {
      void McpObservability.recordCall(serverName, `resource:${uri}`, Date.now() - start, true, context, error);
      throw error;
    }
  }

  /**
   * Gets a prompt from an upstream MCP server with resilience patterns.
   */
  async invokePrompt(serverName: string, promptName: string, args: Record<string, string>, client: Client, context?: ToolExecutionContext, optionsOverride?: ProxyInvokerOptions): Promise<GetPromptResult> {
    const start = Date.now();
    try {
      const result = await this.wrapCall(serverName, `prompt:${promptName}`, () => {
        // Sprint 65 FIX: Pass _meta both as top-level field and merged into arguments

        // HOTFIX 5: Build _meta conditionally - don't include undefined modelId
        const meta: any = context ? {
          userRoles: context.userRoles,
          userId: context.userId,
          correlationId: context.correlationId,
          sessionId: context.sessionId,
        } : undefined;

        // Only include modelId if it exists (don't send undefined)
        if (context?.modelId) {
          meta.modelId = context.modelId;
        }

        return client.getPrompt({
          name: promptName,
          arguments: { ...args, _meta: meta },
          _meta: meta,  // Also pass as top-level field
        } as any);
      },
        optionsOverride,
        context
      );
      void McpObservability.recordCall(serverName, `prompt:${promptName}`, Date.now() - start, false, context);
      return result as GetPromptResult;
    } catch (error) {
      void McpObservability.recordCall(serverName, `prompt:${promptName}`, Date.now() - start, true, context, error);
      throw error;
    }
  }

  private async wrapCall<T>(
    serverName: string, 
    operationId: string, 
    callFn: () => Promise<T>,
    optionsOverride?: ProxyInvokerOptions,
    context?: ToolExecutionContext
  ): Promise<T> {
    const cb = this.getCircuitBreaker(serverName);
    const timeoutMs = optionsOverride?.timeoutMs || this.options.timeoutMs!;
    const failureThreshold = optionsOverride?.failureThreshold || this.options.failureThreshold!;
    const resetTimeoutMs = optionsOverride?.resetTimeoutMs || this.options.resetTimeoutMs!;
    const logger = optionsOverride?.logger || this.options.logger;

    // Check circuit status
    if (cb.state === 'OPEN') {
      const now = Date.now();
      if (now - (cb.lastFailureAt || 0) > resetTimeoutMs) {
        cb.state = 'HALF_OPEN';
      } else {
        const error = new Error(`Circuit breaker is OPEN for server: ${serverName}`);
        logger?.warn?.('mcp.proxy_invoker.circuit_open', { serverName, operationId });
        throw error;
      }
    }

    // Set up timeout and invocation
    const invokePromise = callFn();

    let timeoutTimer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(() => {
        const error = new Error(`Upstream Timeout: Invoking ${operationId} on server ${serverName} exceeded ${timeoutMs}ms`);
        logger?.error?.('mcp.proxy_invoker.upstream_timeout', { serverName, operationId, timeoutMs });
        reject(error);
      }, timeoutMs);

      if (context?.signal) {
        if (context.signal.aborted) {
          clearTimeout(timeoutTimer);
          reject(new Error(`Caller Abort: Invocation of ${operationId} on server ${serverName} was already aborted`));
        } else {
          context.signal.addEventListener('abort', () => {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            const error = new Error(`Caller Abort: Invocation of ${operationId} on server ${serverName} aborted by caller`);
            logger?.warn?.('mcp.proxy_invoker.caller_abort', { serverName, operationId });
            reject(error);
          }, { once: true });
        }
      }
    });

    try {
      // Race against timeout
      const result = await Promise.race([invokePromise, timeoutPromise]);

      // Clear the timeout since the invocation completed successfully
      if (timeoutTimer) clearTimeout(timeoutTimer);

      // Reset on success or handle tool-reported error
      if (result && typeof result === 'object' && (result as any).isError) {
        this.recordFailure(serverName, failureThreshold);
      } else {
        this.recordSuccess(serverName);
      }

      return result as T;
    } catch (error: any) {
      // Clear the timeout since we're handling an error
      if (timeoutTimer) clearTimeout(timeoutTimer);

      // Transport failure, timeout, or server crash
      this.recordFailure(serverName, failureThreshold);
      throw error;
    }
  }

  /**
   * Returns current circuit state for a server.
   */
  public getCircuitState(serverName: string): CircuitState {
    return { ...this.getCircuitBreaker(serverName) };
  }

  private getCircuitBreaker(serverName: string): CircuitState {
    let cb = this.circuitBreakers.get(serverName);
    if (!cb) {
      cb = { state: 'CLOSED', consecutiveFailures: 0 };
      this.circuitBreakers.set(serverName, cb);
    }
    return cb;
  }

  private recordFailure(serverName: string, failureThreshold: number) {
    const cb = this.getCircuitBreaker(serverName);
    cb.consecutiveFailures++;
    cb.lastFailureAt = Date.now();

    if (cb.consecutiveFailures >= failureThreshold) {
      cb.state = 'OPEN';
    }
  }

  private recordSuccess(serverName: string) {
    const cb = this.getCircuitBreaker(serverName);
    cb.state = 'CLOSED';
    cb.consecutiveFailures = 0;
  }
}

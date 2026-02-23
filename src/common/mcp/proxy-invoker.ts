import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { CallToolResult, CallToolResultSchema, ReadResourceResult, ReadResourceResultSchema, GetPromptResult, GetPromptResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { ToolExecutionContext } from '../../types/tools';
import { McpObservability } from './observability';

export interface ProxyInvokerOptions {
  /**
   * Maximum time (in ms) to wait for a tool invocation to complete.
   * Default: 15000 (15 seconds)
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
    this.options.timeoutMs = this.options.timeoutMs || 15000;
    this.options.failureThreshold = this.options.failureThreshold || 5;
    this.options.resetTimeoutMs = this.options.resetTimeoutMs || 30000;
  }

  /**
   * Invokes a tool on an upstream MCP server with resilience patterns.
   */
  async invoke(serverName: string, toolName: string, args: any, client: Client, context?: ToolExecutionContext): Promise<CallToolResult> {
    const start = Date.now();
    try {
      const result = await this.wrapCall(serverName, `tool:${toolName}`, () => 
        client.callTool({ name: toolName, arguments: args }, CallToolResultSchema)
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
  async invokeResource(serverName: string, uri: string, client: Client, context?: ToolExecutionContext): Promise<ReadResourceResult> {
    const start = Date.now();
    try {
      const result = await this.wrapCall(serverName, `resource:${uri}`, () =>
        client.readResource({ uri })
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
  async invokePrompt(serverName: string, promptName: string, args: Record<string, string>, client: Client, context?: ToolExecutionContext): Promise<GetPromptResult> {
    const start = Date.now();
    try {
      const result = await this.wrapCall(serverName, `prompt:${promptName}`, () =>
        client.getPrompt({ name: promptName, arguments: args })
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
    callFn: () => Promise<T>
  ): Promise<T> {
    const cb = this.getCircuitBreaker(serverName);

    // Check circuit status
    if (cb.state === 'OPEN') {
      const now = Date.now();
      if (now - (cb.lastFailureAt || 0) > this.options.resetTimeoutMs!) {
        cb.state = 'HALF_OPEN';
      } else {
        throw new Error(`Circuit breaker is OPEN for server: ${serverName}`);
      }
    }

    // Set up timeout and invocation
    const invokePromise = callFn();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Timeout invoking ${operationId} on server ${serverName} after ${this.options.timeoutMs}ms`)),
        this.options.timeoutMs
      );
    });

    try {
      // Race against timeout
      const result = await Promise.race([invokePromise, timeoutPromise]);

      // Reset on success or handle tool-reported error
      if (result && typeof result === 'object' && (result as any).isError) {
        this.recordFailure(serverName);
      } else {
        this.recordSuccess(serverName);
      }

      return result as T;
    } catch (error: any) {
      // Transport failure, timeout, or server crash
      this.recordFailure(serverName);
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

  private recordFailure(serverName: string) {
    const cb = this.getCircuitBreaker(serverName);
    cb.consecutiveFailures++;
    cb.lastFailureAt = Date.now();

    if (cb.consecutiveFailures >= this.options.failureThreshold!) {
      cb.state = 'OPEN';
    }
  }

  private recordSuccess(serverName: string) {
    const cb = this.getCircuitBreaker(serverName);
    cb.state = 'CLOSED';
    cb.consecutiveFailures = 0;
  }
}

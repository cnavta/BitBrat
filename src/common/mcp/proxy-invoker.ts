import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { CallToolResult, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

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
  async invoke(serverName: string, toolName: string, args: any, client: Client): Promise<CallToolResult> {
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
    const invokePromise = client.callTool(
      {
        name: toolName,
        arguments: args,
      },
      CallToolResultSchema
    );

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Timeout invoking tool ${toolName} on server ${serverName} after ${this.options.timeoutMs}ms`)),
        this.options.timeoutMs
      );
    });

    try {
      // Race against timeout
      const result = (await Promise.race([invokePromise, timeoutPromise])) as CallToolResult;

      // Reset on success or handle tool-reported error
      if (result.isError) {
        // Tool reported an internal error (e.g. invalid arguments or logical failure)
        // Does this count as server failure?
        // Let's count it for now to be safe, though often these are logical errors.
        // We could distinguish based on result.content but that's complex.
        this.recordFailure(serverName);
      } else {
        this.recordSuccess(serverName);
      }

      return result;
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

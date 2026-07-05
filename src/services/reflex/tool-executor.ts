/**
 * Tool Executor for Reflex Bit
 *
 * Executes MCP tools via the tool-gateway service.
 * Provides timeout protection, error handling, and comprehensive logging.
 *
 * Tool-gateway integration:
 * - Endpoint: POST /mcp/invoke
 * - Authentication: Bearer token via MCP_AUTH_TOKEN env var
 * - Timeout: Configurable per tool (default 5000ms)
 */

import { logger } from '../../common/logging';

/**
 * Error thrown when tool execution times out.
 */
export class ToolExecutionTimeoutError extends Error {
  constructor(tool: string, timeout: number) {
    super(`Tool execution timeout after ${timeout}ms: ${tool}`);
    this.name = 'ToolExecutionTimeoutError';
  }
}

/**
 * Error thrown when tool execution fails.
 */
export class ToolExecutionError extends Error {
  public readonly statusCode?: number;
  public readonly toolResponse?: any;

  constructor(tool: string, message: string, statusCode?: number, toolResponse?: any) {
    super(`Tool execution failed for ${tool}: ${message}`);
    this.name = 'ToolExecutionError';
    this.statusCode = statusCode;
    this.toolResponse = toolResponse;
  }
}

/**
 * Configuration for tool execution.
 */
export interface ToolExecutionConfig {
  /** Tool-gateway base URL (from environment or override) */
  gatewayUrl?: string;

  /** MCP authentication token (from environment or override) */
  authToken?: string;

  /** Timeout in milliseconds (default: 5000) */
  timeout?: number;

  /** Correlation ID for request tracing */
  correlationId?: string;
}

/**
 * Executes an MCP tool via the tool-gateway service.
 *
 * Process:
 * 1. Build HTTP request to tool-gateway
 * 2. Add authentication header
 * 3. Set timeout protection
 * 4. POST request with tool name and parameters
 * 5. Parse and return result
 *
 * @param tool - Fully qualified MCP tool name (e.g., 'obs.set_source_visibility')
 * @param parameters - Tool parameters (already interpolated)
 * @param config - Execution configuration
 * @returns Tool execution result
 * @throws {ToolExecutionTimeoutError} If execution exceeds timeout
 * @throws {ToolExecutionError} If tool-gateway returns an error
 *
 * @example
 * const result = await executeTool(
 *   'obs.set_source_visibility',
 *   { sourceName: 'FailOverlay', visible: true },
 *   { timeout: 3000, correlationId: '...' }
 * );
 */
export async function executeTool(
  tool: string,
  parameters: Record<string, any>,
  config: ToolExecutionConfig = {}
): Promise<any> {
  const {
    gatewayUrl = process.env.TOOL_GATEWAY_URL || 'http://tool-gateway:3000',
    authToken = process.env.MCP_AUTH_TOKEN,
    timeout = 5000,
    correlationId,
  } = config;

  if (!authToken) {
    throw new ToolExecutionError(
      tool,
      'MCP_AUTH_TOKEN environment variable not set',
      undefined,
      undefined
    );
  }

  const startTime = Date.now();

  try {
    // Build request
    const url = `${gatewayUrl}/mcp/invoke`;
    const body = {
      tool,
      arguments: parameters,
    };

    logger.debug('[tool-executor] Invoking MCP tool:', {
      tool,
      url,
      parameters,
      timeout,
      ...(correlationId && { correlationId }),
    });

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      // Make HTTP request
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
          ...(correlationId && { 'X-Correlation-ID': correlationId }),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const latency = Date.now() - startTime;

      // Handle non-2xx responses
      if (!response.ok) {
        let errorBody: any;
        try {
          errorBody = await response.json();
        } catch {
          errorBody = await response.text();
        }

        logger.error('[tool-executor] Tool invocation failed:', {
          tool,
          statusCode: response.status,
          statusText: response.statusText,
          latency,
          errorBody,
        });

        throw new ToolExecutionError(tool, response.statusText, response.status, errorBody);
      }

      // Parse successful response
      const result = await response.json();

      logger.info('[tool-executor] Tool invocation successful:', {
        tool,
        latency: `${latency}ms`,
        ...(correlationId && { correlationId }),
      });

      return result;
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle timeout
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ToolExecutionTimeoutError(tool, timeout);
      }

      // Re-throw if already a ToolExecutionError
      if (error instanceof ToolExecutionError) {
        throw error;
      }

      // Wrap other errors
      throw new ToolExecutionError(
        tool,
        error instanceof Error ? error.message : String(error),
        undefined,
        undefined
      );
    }
  } catch (error) {
    const latency = Date.now() - startTime;

    logger.error('[tool-executor] Tool execution error:', {
      tool,
      error: error instanceof Error ? error.message : String(error),
      latency: `${latency}ms`,
      ...(correlationId && { correlationId }),
    });

    throw error;
  }
}

/**
 * Validates tool execution configuration.
 *
 * @param config - Configuration to validate
 * @returns Validation result
 */
export function validateToolConfig(config: ToolExecutionConfig): {
  isValid: boolean;
  errors?: string[];
} {
  const errors: string[] = [];

  if (config.timeout !== undefined) {
    if (config.timeout <= 0) {
      errors.push('Timeout must be greater than 0');
    }
    if (config.timeout > 60000) {
      errors.push('Timeout cannot exceed 60000ms (60 seconds)');
    }
  }

  if (config.gatewayUrl !== undefined) {
    try {
      new URL(config.gatewayUrl);
    } catch {
      errors.push(`Invalid gateway URL: ${config.gatewayUrl}`);
    }
  }

  return {
    isValid: errors.length === 0,
    ...(errors.length > 0 && { errors }),
  };
}

/**
 * Gets the configured tool-gateway URL.
 *
 * Checks environment variable or returns default.
 *
 * @returns Tool-gateway URL
 */
export function getToolGatewayUrl(): string {
  return process.env.TOOL_GATEWAY_URL || 'http://tool-gateway:3000';
}

/**
 * Checks if MCP authentication is configured.
 *
 * @returns true if MCP_AUTH_TOKEN is set
 */
export function isMcpAuthConfigured(): boolean {
  return !!process.env.MCP_AUTH_TOKEN;
}

/**
 * Reusable MCP HTTP Client for Testing
 *
 * Provides utilities for testing MCP endpoints via HTTP/HTTPS.
 * Supports both JSON-RPC 2.0 calls and tool invocations.
 *
 * Usage:
 * ```typescript
 * const client = new McpTestClient({
 *   url: 'http://bitbrat.lan:3000/mcp',
 *   authToken: 'your-token-here'
 * });
 *
 * // List available tools
 * const tools = await client.listTools();
 *
 * // Call a tool
 * const result = await client.callTool('model.get', { id: 'gpt-4' });
 * ```
 */

import * as https from 'https';

export interface McpClientConfig {
  /** Full URL to MCP endpoint (e.g., http://localhost:3000/mcp) */
  url: string;

  /** Authentication token (MCP_AUTH_TOKEN) */
  authToken?: string;

  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** Additional HTTP headers */
  headers?: Record<string, string>;

  /** Allow self-signed certificates (for testing) */
  rejectUnauthorized?: boolean;
}

export interface McpToolCallResult {
  content: Array<{
    type: string;
    text?: string;
    [key: string]: any;
  }>;
  isError?: boolean;
  _meta?: Record<string, any>;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
  };
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

/**
 * MCP Test Client
 *
 * Implements MCP JSON-RPC 2.0 protocol over HTTP.
 * Designed for testing MCP endpoints in integration tests and scripts.
 */
export class McpTestClient {
  private config: Required<McpClientConfig>;
  private requestId = 1;
  private initialized = false;

  constructor(config: McpClientConfig) {
    this.config = {
      timeout: 30000,
      headers: {},
      rejectUnauthorized: true,
      ...config,
      authToken: config.authToken || '',
    };
  }

  /**
   * Initialize MCP session
   * Sends 'initialize' request to establish protocol version and capabilities
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const response = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      clientInfo: {
        name: 'mcp-test-client',
        version: '1.0.0',
      },
    });

    if (response.error) {
      throw new Error(`MCP initialize failed: ${response.error.message}`);
    }

    this.initialized = true;
  }

  /**
   * List all available tools from MCP server
   */
  async listTools(): Promise<McpTool[]> {
    await this.initialize();

    const response = await this.sendRequest('tools/list', {});

    if (response.error) {
      throw new Error(`listTools failed: ${response.error.message}`);
    }

    return response.result?.tools || [];
  }

  /**
   * Call an MCP tool
   *
   * @param toolName - Name of the tool to call
   * @param args - Tool arguments (schema-validated by server)
   * @returns Tool execution result
   */
  async callTool(toolName: string, args: Record<string, any> = {}): Promise<McpToolCallResult> {
    await this.initialize();

    const response = await this.sendRequest('tools/call', {
      name: toolName,
      arguments: args,
    });

    if (response.error) {
      throw new Error(`Tool call failed: ${response.error.message}`);
    }

    return response.result as McpToolCallResult;
  }

  /**
   * Parse response data (handles both SSE and plain JSON formats)
   * @private
   */
  private parseResponse(data: string): JsonRpcResponse {
    // Try plain JSON first
    if (data.trim().startsWith('{')) {
      try {
        return JSON.parse(data) as JsonRpcResponse;
      } catch {
        // Fall through to SSE parsing
      }
    }

    // Parse SSE format: "event: message\ndata: {json}\n\n"
    const lines = data.split('\n');
    let jsonData: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Look for "data:" line
      if (line.startsWith('data:')) {
        jsonData = line.substring(5).trim();
        break;
      }
    }

    if (!jsonData) {
      throw new Error(`No JSON data found in SSE response: ${data.substring(0, 200)}`);
    }

    return JSON.parse(jsonData) as JsonRpcResponse;
  }

  /**
   * Send raw JSON-RPC 2.0 request to MCP endpoint
   */
  async sendRequest(method: string, params?: any): Promise<JsonRpcResponse> {
    const url = new URL(this.config.url);
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method,
      params,
    };

    const body = JSON.stringify(request);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body).toString(),
      // MCP Streamable HTTP requires both content types
      'Accept': 'application/json, text/event-stream',
      ...this.config.headers,
    };

    if (this.config.authToken) {
      headers['Authorization'] = `Bearer ${this.config.authToken}`;
    }

    return new Promise((resolve, reject) => {
      const protocol = url.protocol === 'https:' ? https : require('http');

      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers,
        timeout: this.config.timeout,
        rejectUnauthorized: this.config.rejectUnauthorized,
      };

      const req = protocol.request(options, (res: any) => {
        let data = '';

        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });

        res.on('end', () => {
          try {
            // MCP Streamable HTTP returns SSE format even for POST requests
            // Format: "event: message\ndata: {json}\n\n"
            const response = this.parseResponse(data);
            resolve(response);
          } catch (err) {
            reject(new Error(`Failed to parse response: ${err instanceof Error ? err.message : String(err)}`));
          }
        });
      });

      req.on('error', (err: Error) => {
        reject(new Error(`HTTP request failed: ${err.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timeout after ${this.config.timeout}ms`));
      });

      req.write(body);
      req.end();
    });
  }

  /**
   * Helper: Pretty-print tool call result
   */
  static formatToolResult(result: McpToolCallResult): string {
    if (result.isError) {
      return `ERROR: ${result.content[0]?.text || 'Unknown error'}`;
    }

    if (result.content.length === 0) {
      return '(empty result)';
    }

    return result.content
      .map(c => {
        if (c.type === 'text' && c.text) {
          return c.text;
        }
        return JSON.stringify(c, null, 2);
      })
      .join('\n');
  }

  /**
   * Helper: Assert tool call succeeded
   */
  static assertSuccess(result: McpToolCallResult, message?: string): void {
    if (result.isError) {
      throw new Error(message || `Tool call failed: ${result.content[0]?.text}`);
    }
  }

  /**
   * Helper: Extract text content from tool result
   */
  static extractText(result: McpToolCallResult): string {
    const textContent = result.content.find(c => c.type === 'text');
    return textContent?.text || '';
  }

  /**
   * Helper: Parse JSON from tool result text
   */
  static parseJson<T = any>(result: McpToolCallResult): T {
    const text = McpTestClient.extractText(result);
    return JSON.parse(text) as T;
  }
}

/**
 * Helper: Create MCP client from context name
 *
 * Reads configuration from architecture.yaml and .secure.{context}/.env
 *
 * @param context - Context name (local, staging, production)
 * @param overrides - Optional config overrides
 */
export async function createMcpClientForContext(
  context: string,
  overrides?: Partial<McpClientConfig>
): Promise<McpTestClient> {
  const fs = await import('fs');
  const path = await import('path');
  const yaml = await import('js-yaml');

  // Load architecture.yaml
  const repoRoot = path.join(__dirname, '../..');
  const archPath = path.join(repoRoot, 'architecture.yaml');
  const archYaml = fs.readFileSync(archPath, 'utf-8');
  const arch = yaml.load(archYaml) as any;

  const ctxConfig = arch.executionContexts?.[context];
  if (!ctxConfig) {
    throw new Error(`Context '${context}' not found in architecture.yaml`);
  }

  // Determine URL
  let url: string;
  if (context === 'local') {
    // Local: http://localhost:{port}/mcp
    const port = process.env.TOOL_ORCHESTRATOR_HOST_PORT || '3000';
    url = `http://localhost:${port}/mcp`;
  } else {
    // Remote: Discover port from running container or use fallback
    const dockerHost = ctxConfig.deployment?.docker?.host;
    if (dockerHost && dockerHost.startsWith('ssh://')) {
      const hostname = dockerHost.replace('ssh://', '').split('@')[1];

      // Try to discover port from running container
      let port = ctxConfig.runtime?.gateway?.fallbackPort || 3000;
      try {
        const { execSync } = await import('child_process');
        const containerName = `bitbrat-${context}-tool-orchestrator-1`;
        const portMapping = execSync(
          `ssh root@${hostname} "docker port ${containerName} 3000 2>/dev/null || echo ''"`,
          { encoding: 'utf-8' }
        ).trim();

        if (portMapping) {
          // Format: 0.0.0.0:3027 or [::]:3027
          const match = portMapping.match(/:(\d+)$/);
          if (match) {
            port = parseInt(match[1], 10);
          }
        }
      } catch (err) {
        // Fallback to default port if discovery fails
        console.warn(`Port discovery failed, using fallback port ${port}`);
      }

      url = `http://${hostname}:${port}/mcp`;
    } else {
      throw new Error(`Cannot derive MCP URL for context '${context}'`);
    }
  }

  // Load auth token from .secure.{context}/.env
  let authToken: string | undefined;
  const securePath = path.join(repoRoot, `.secure.${context}/.env`);
  if (fs.existsSync(securePath)) {
    const envContent = fs.readFileSync(securePath, 'utf-8');
    const match = envContent.match(/^MCP_AUTH_TOKEN=(.+)$/m);
    if (match) {
      authToken = match[1].trim();
    }
  }

  return new McpTestClient({
    url,
    authToken,
    ...overrides,
  });
}

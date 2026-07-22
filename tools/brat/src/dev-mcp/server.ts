/**
 * Dev MCP Server - Main server implementation
 *
 * Provides MCP server functionality for development tooling access.
 * Supports stdio transport for agent integration.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { DevMcpServerOptions } from './types.js';
import { TargetConnectionManager } from './target-manager.js';
import { ToolRouter } from './tool-router.js';
import { AuditLogger } from './audit-logger.js';
import { createLogger, Logger } from '../orchestration/logger';
import { configTools } from './tools/config.js';
import { persistenceTools } from './tools/persistence.js';
import { fleetTools } from './tools/fleet.js';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * Find repository root by walking up directory tree
 */
function findRootDir(): string {
  // Start from current directory
  let current = process.cwd();

  while (true) {
    // Check if architecture.yaml exists in current directory
    if (existsSync(resolve(current, 'architecture.yaml'))) {
      return current;
    }

    // Move up one directory
    const parent = dirname(current);

    // Stop if we've reached filesystem root
    if (parent === current) {
      throw new Error('Could not find repository root (architecture.yaml not found)');
    }

    current = parent;
  }
}

/**
 * Dev MCP Server
 *
 * Entry point for the development MCP server. Coordinates:
 * - Target connection management
 * - Tool registration and dispatch
 * - Audit logging
 * - MCP protocol handling
 */
export class DevMcpServer {
  private server: Server;
  private targetManager: TargetConnectionManager;
  private toolRouter: ToolRouter;
  private auditLogger: AuditLogger;
  private logger: Logger;
  private transport?: StdioServerTransport;

  constructor(options: DevMcpServerOptions = {}) {
    this.logger = createLogger({
      base: { component: 'dev-mcp-server' },
      level: options.logLevel || 'info'
    });

    // Handle backward compatibility: target → context
    let defaultContext = options.context;
    if (!defaultContext && options.target) {
      this.logger.warn({
        deprecation: 'target parameter',
        replacement: 'context parameter',
        removal: 'Sprint 357',
      }, 'DEPRECATION WARNING: options.target is deprecated. Use options.context instead.');
      defaultContext = options.target;
    }

    // Initialize MCP server
    this.server = new Server(
      {
        name: 'brat-dev-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Find repository root for context resolution
    const repoRoot = findRootDir();

    // Initialize components
    this.targetManager = new TargetConnectionManager(repoRoot, defaultContext, this.logger);
    this.toolRouter = new ToolRouter(this.targetManager, this.logger);
    this.auditLogger = new AuditLogger(options.auditLogPath, this.logger);

    // Register tools
    this.registerTools();

    // Register MCP handlers
    this.registerHandlers();

    this.logger.info({
      defaultContext,
      logLevel: options.logLevel,
      repoRoot,
    }, 'Dev MCP server initialized');
  }

  /**
   * Register development tools
   */
  private registerTools(): void {
    // Register config tools
    for (const tool of configTools) {
      this.toolRouter.registerTool(tool);
    }

    // Register persistence tools
    for (const tool of persistenceTools) {
      this.toolRouter.registerTool(tool);
    }

    // Register fleet tools
    for (const tool of fleetTools) {
      this.toolRouter.registerTool(tool);
    }

    const totalTools = configTools.length + persistenceTools.length + fleetTools.length;
    this.logger.info({
      config: configTools.length,
      persistence: persistenceTools.length,
      fleet: fleetTools.length,
      total: totalTools,
    }, 'Registered dev tools');
  }

  /**
   * Register MCP protocol handlers
   */
  private registerHandlers(): void {
    // Handle tools/list
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = this.toolRouter.listTools();
      this.logger.debug({ count: tools.length }, 'Listed tools');
      return { tools };
    });

    // Handle tools/call
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const startTime = Date.now();
      const { name, arguments: args = {} } = request.params;

      this.logger.info({ tool: name, args }, 'Tool called');

      try {
        // Get active connection (uses default target if not specified in args)
        const connection = await this.targetManager.getActiveConnection(
          (args as any).target
        );

        // Call tool
        const result = await this.toolRouter.callTool(name, args, connection);

        // Log success
        const durationMs = Date.now() - startTime;
        await this.auditLogger.logToolCall({
          tool: name,
          args,
          target: connection.name,
          durationMs,
          success: true,
        });

        this.logger.info({ tool: name, durationMs }, 'Tool succeeded');

        return result;
      } catch (error: any) {
        // Log failure
        const durationMs = Date.now() - startTime;
        await this.auditLogger.logToolCall({
          tool: name,
          args,
          target: 'unknown',
          durationMs,
          success: false,
          error: error.message,
        });

        this.logger.error({ tool: name, error: error.message }, 'Tool failed');

        // Return error as content block
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    this.logger.info('Starting Dev MCP server...');

    // Create stdio transport
    this.transport = new StdioServerTransport();

    // Connect server to transport
    await this.server.connect(this.transport);

    this.logger.info('Dev MCP server started on stdio');
  }

  /**
   * Shutdown the MCP server
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down Dev MCP server...');

    // Disconnect target connections
    await this.targetManager.disconnectAll();

    // Close transport
    if (this.transport) {
      await this.transport.close();
    }

    // Close audit log
    await this.auditLogger.close();

    this.logger.info('Dev MCP server shut down');
  }

  /**
   * Get tool router (for tool registration)
   */
  getToolRouter(): ToolRouter {
    return this.toolRouter;
  }
}

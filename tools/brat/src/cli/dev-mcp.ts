/**
 * Dev MCP CLI Command
 *
 * Command handler for `brat dev-mcp start`
 */

import { DevMcpServer } from '../dev-mcp/server.js';
import { createLogger } from '../orchestration/logger';

export interface DevMcpFlags {
  target?: string;
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
  auditLog?: string;
}

/**
 * Command: brat dev-mcp start
 */
export async function cmdDevMcp(
  action: string,
  flags: DevMcpFlags
): Promise<void> {
  const logger = createLogger({
    base: { component: 'dev-mcp-cli' },
    level: flags.logLevel || 'info'
  });

  if (action !== 'start') {
    logger.error(`Unknown dev-mcp action: ${action}`);
    console.error(`Unknown dev-mcp action: ${action}`);
    console.error('Usage: brat dev-mcp start [--target <name>] [--log-level <level>]');
    process.exit(1);
  }

  // Check for authentication token (fail-closed)
  const authToken = process.env.MCP_DEV_TOKEN || process.env.MCP_AUTH_TOKEN;
  if (!authToken) {
    logger.error('No authentication token found');
    console.error('Error: No authentication token found');
    console.error('Please set MCP_DEV_TOKEN or MCP_AUTH_TOKEN environment variable');
    process.exit(1);
  }

  // Create and start server
  const server = new DevMcpServer({
    target: flags.target,
    logLevel: flags.logLevel,
    auditLogPath: flags.auditLog,
    authToken,
  });

  // Handle graceful shutdown
  const shutdown = async () => {
    logger.info('Received shutdown signal');
    await server.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start server
  try {
    await server.start();

    // Print startup message to stderr (so stdout is clean for MCP protocol)
    console.error(`Dev MCP server started on stdio (target: ${flags.target || 'default'})`);
    console.error(`Audit log: ${flags.auditLog || '.brat/dev-mcp-audit.log'}`);
    console.error('Ready for MCP protocol messages on stdin/stdout');
  } catch (error: any) {
    logger.error(`Failed to start server: ${error.message}`);
    console.error(`Error: Failed to start server: ${error.message}`);
    process.exit(1);
  }
}

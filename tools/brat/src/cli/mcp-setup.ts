/**
 * MCP Setup CLI Command
 *
 * Command handler for `brat mcp setup`
 * Configures the BitBrat dev MCP server in Claude Code's config
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { createLogger } from '../orchestration/logger';

export interface McpSetupFlags {
  /** Execution context name */
  context?: string;
  /**
   * @deprecated Use context instead. Will be removed in Sprint 357.
   */
  target?: string;
  scope?: 'local' | 'user' | 'project';
  serverName?: string;
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
  auditLog?: string;
  dryRun?: boolean;
  json?: boolean;
}

const DEFAULT_SERVER_NAME = 'bitbrat-dev';

/**
 * Get the appropriate config file path based on scope
 */
function getConfigPath(scope: 'local' | 'user' | 'project', projectRoot: string): string {
  if (scope === 'project') {
    return path.join(projectRoot, '.mcp.json');
  }
  // Both 'local' and 'user' use ~/.claude.json
  const homeDir = os.homedir();
  return path.join(homeDir, '.claude.json');
}

/**
 * Read existing config or create empty structure
 */
function readConfig(configPath: string): any {
  if (!fs.existsSync(configPath)) {
    return { mcpServers: {} };
  }

  const content = fs.readFileSync(configPath, 'utf8');
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse ${configPath}: ${error}`);
  }
}

/**
 * Write config back to file
 */
function writeConfig(configPath: string, config: any): void {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

/**
 * Build the MCP server configuration
 */
function buildServerConfig(flags: McpSetupFlags, projectRoot: string): any {
  const config: any = {
    type: 'stdio',
    command: 'npm',
    args: ['run', 'brat', '--', 'dev-mcp', 'start'],
    env: {
      MCP_DEV_TOKEN: '${MCP_DEV_TOKEN:-test-token-123}',
    },
  };

  // Handle backward compatibility: target → context
  const contextName = flags.context || flags.target;

  // Add context if specified
  if (contextName) {
    config.args.push('--context', contextName);
  }

  // Add log level if specified
  if (flags.logLevel) {
    config.args.push('--log-level', flags.logLevel);
  }

  // Add audit log if specified
  if (flags.auditLog) {
    config.args.push('--audit-log', flags.auditLog);
  }

  return config;
}

/**
 * Command: brat mcp setup
 */
export async function cmdMcpSetup(flags: McpSetupFlags): Promise<void> {
  // Suppress logger output when JSON mode is enabled (JSON should be the only stdout)
  const logger = createLogger({
    base: { component: 'mcp-setup-cli' },
    level: flags.json ? 'silent' : (flags.logLevel || 'info'),
  });

  const scope = flags.scope || 'user';
  const serverName = flags.serverName || DEFAULT_SERVER_NAME;
  const projectRoot = process.cwd();

  try {
    // Get config path
    const configPath = getConfigPath(scope, projectRoot);
    logger.info({ configPath, scope, serverName }, 'Setting up MCP server');

    // Read existing config
    const config = readConfig(configPath);

    // Ensure mcpServers section exists
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    // Build server config
    const serverConfig = buildServerConfig(flags, projectRoot);

    // Check if server already exists
    const alreadyExists = !!config.mcpServers[serverName];
    if (alreadyExists) {
      logger.info({ serverName }, 'Server already exists, updating configuration');
    }

    // Add/update server config
    config.mcpServers[serverName] = serverConfig;

    // Prepare result
    const result = {
      action: alreadyExists ? 'updated' : 'created',
      serverName,
      scope,
      configPath,
      config: serverConfig,
      instructions: [
        `MCP server '${serverName}' has been ${alreadyExists ? 'updated' : 'created'}`,
        `Configuration saved to: ${configPath}`,
        '',
        'To use this server:',
        '1. Ensure MCP_DEV_TOKEN is set in your environment:',
        '   export MCP_DEV_TOKEN="test-token-123"',
        '',
        '2. Verify the server is available:',
        '   claude mcp list',
        '',
        '3. The server will be automatically available in Claude Code sessions',
        '',
        'Command to test:',
        `   npm run brat -- dev-mcp start${flags.target ? ` --target ${flags.target}` : ''}`,
      ],
    };

    // Write config (unless dry-run)
    if (flags.dryRun) {
      logger.info({ dryRun: true }, 'DRY-RUN: Would write config');
      result.instructions.unshift('[DRY-RUN] No files were modified');
    } else {
      writeConfig(configPath, config);
      logger.info({ configPath }, 'Config written successfully');
    }

    // Output result
    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result.instructions.join('\n'));
    }
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to setup MCP server');
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

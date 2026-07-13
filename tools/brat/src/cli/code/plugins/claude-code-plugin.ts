import { spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import { BasePlugin, type AgentDetectionResult, type AgentConfig, type ProjectContext } from './base-plugin';

const exec = promisify(execCallback);

/**
 * Plugin for Claude Code (Anthropic's official CLI coding agent).
 *
 * Claude Code is a terminal-based coding assistant that integrates with
 * the Claude API and supports MCP (Model Context Protocol) for tool use.
 *
 * Official docs: https://docs.claude.com/claude-code
 */
export class ClaudeCodePlugin extends BasePlugin {
  readonly id = 'claude-code';
  readonly name = 'Claude Code';
  readonly minVersion = '0.1.0';

  /**
   * Detect if Claude Code is installed.
   *
   * Checks for `claude` command in PATH and verifies version.
   */
  async detect(): Promise<AgentDetectionResult> {
    try {
      // Check if claude command exists
      const { stdout, stderr } = await exec('claude --version');
      const output = (stdout || stderr).trim();

      // Extract version
      const version = this.extractVersion(output);
      if (!version) {
        return {
          installed: false,
          issues: ['Could not parse version from output'],
        };
      }

      // Check minimum version
      if (!this.compareVersions(version, this.minVersion)) {
        return {
          installed: true,
          version,
          issues: [`Version ${version} is below minimum required version ${this.minVersion}`],
        };
      }

      // Get command path
      const { stdout: wherePath } = await exec(process.platform === 'win32' ? 'where claude' : 'which claude');
      const path = wherePath.trim().split('\n')[0];

      return {
        installed: true,
        version,
        path,
      };
    } catch (err) {
      // Command not found or execution failed
      return {
        installed: false,
        issues: [`claude command not found in PATH`],
      };
    }
  }

  /**
   * Prepare configuration for Claude Code.
   *
   * Injects BitBrat project context and configures MCP if available.
   */
  async prepareConfig(projectContext: ProjectContext): Promise<AgentConfig> {
    const args: string[] = [];
    const env: Record<string, string> = {};

    // Add project documentation as initial context
    // Note: Claude Code doesn't have a direct way to inject initial context via CLI
    // This would typically be done through the interactive session or via a config file
    // For now, we'll rely on CLAUDE.md being in the project root which Claude Code
    // automatically discovers

    // Configure MCP if available
    if (projectContext.mcp?.available) {
      // Claude Code supports MCP via configuration
      // The MCP server config would go in the user's Claude settings
      // For now, we'll set environment variables that could be used by MCP servers
      if (projectContext.mcp.toolGatewayUrl) {
        env.BITBRAT_TOOL_GATEWAY = projectContext.mcp.toolGatewayUrl;
      }
      if (projectContext.mcp.authToken) {
        env.BITBRAT_MCP_TOKEN = projectContext.mcp.authToken;
      }
    }

    // Set working directory to project root
    const cwd = projectContext.root;

    return {
      command: 'claude',
      args,
      env,
      cwd,
      configFiles: [],
    };
  }

  /**
   * Launch Claude Code.
   *
   * Spawns the claude process with prepared configuration.
   */
  async launch(config: AgentConfig, args: string[]): Promise<ChildProcess> {
    const env = {
      ...process.env,
      ...config.env,
    };

    const child = spawn(config.command, [...config.args, ...args], {
      cwd: config.cwd,
      env,
      stdio: 'inherit',
    });

    return child;
  }
}

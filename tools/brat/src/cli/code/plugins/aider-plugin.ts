import { spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import { BasePlugin, type AgentDetectionResult, type AgentConfig, type ProjectContext } from './base-plugin';

const exec = promisify(execCallback);

/**
 * Plugin for Aider (AI pair programming in your terminal).
 *
 * Aider is a command-line tool that lets you pair program with LLMs
 * to edit code in your local git repository.
 *
 * Official site: https://aider.chat
 */
export class AiderPlugin extends BasePlugin {
  readonly id = 'aider';
  readonly name = 'Aider';
  readonly minVersion = '0.1.0';

  /**
   * Detect if Aider is installed.
   *
   * Checks for `aider` command in PATH and verifies version.
   */
  async detect(): Promise<AgentDetectionResult> {
    try {
      // Check if aider command exists
      const { stdout, stderr } = await exec('aider --version');
      const output = (stdout || stderr).trim();

      // Extract version (aider outputs "aider version X.Y.Z")
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
      const { stdout: wherePath } = await exec(process.platform === 'win32' ? 'where aider' : 'which aider');
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
        issues: ['aider command not found in PATH'],
      };
    }
  }

  /**
   * Prepare configuration for Aider.
   *
   * Configures Aider with BitBrat project context and documentation.
   */
  async prepareConfig(projectContext: ProjectContext): Promise<AgentConfig> {
    const args: string[] = [];
    const env: Record<string, string> = {};

    // Add read-only context files (documentation)
    if (projectContext.claudeMd) {
      args.push('--read', 'CLAUDE.md');
    }
    if (projectContext.agentsMd) {
      args.push('--read', 'AGENTS.md');
    }

    // Add architecture.yaml as context
    args.push('--read', 'architecture.yaml');

    // Use auto-commit mode (commit after each change)
    args.push('--auto-commits');

    // Set message format to be concise
    args.push('--message-file', '-'); // Read from stdin if needed

    // Configure git
    if (projectContext.gitBranch) {
      // Aider works within the current git branch
      // No special configuration needed
    }

    // Configure MCP if available
    if (projectContext.mcp?.available) {
      // Aider doesn't natively support MCP, but we can set environment variables
      // that could be used by custom integrations
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
      command: 'aider',
      args,
      env,
      cwd,
      configFiles: [],
    };
  }

  /**
   * Launch Aider.
   *
   * Spawns the aider process with prepared configuration.
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

import { spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import { BasePlugin, type AgentDetectionResult, type AgentConfig, type ProjectContext } from './base-plugin';

const exec = promisify(execCallback);

/**
 * Plugin for Continue (open-source autopilot for software development).
 *
 * Continue is an AI coding assistant that integrates with VS Code and JetBrains IDEs,
 * with support for command-line usage.
 *
 * Official site: https://continue.dev
 */
export class ContinuePlugin extends BasePlugin {
  readonly id = 'continue';
  readonly name = 'Continue';
  readonly minVersion = '0.1.0';

  /**
   * Detect if Continue is installed.
   *
   * Checks for `continue` command in PATH and verifies version.
   */
  async detect(): Promise<AgentDetectionResult> {
    try {
      // Check if continue command exists
      const { stdout, stderr } = await exec('continue --version');
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
      const { stdout: wherePath } = await exec(process.platform === 'win32' ? 'where continue' : 'which continue');
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
        issues: ['continue command not found in PATH'],
      };
    }
  }

  /**
   * Prepare configuration for Continue.
   *
   * Configures Continue with BitBrat project context.
   */
  async prepareConfig(projectContext: ProjectContext): Promise<AgentConfig> {
    const args: string[] = [];
    const env: Record<string, string> = {};

    // Continue typically uses a config.json file for configuration
    // We could generate one with project-specific settings

    // Add context about project documentation
    if (projectContext.claudeMd || projectContext.agentsMd) {
      // Continue discovers context from the workspace
      // Documentation files in the root will be automatically available
    }

    // Configure MCP if available
    if (projectContext.mcp?.available) {
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
      command: 'continue',
      args,
      env,
      cwd,
      configFiles: [],
    };
  }

  /**
   * Launch Continue.
   *
   * Spawns the continue process with prepared configuration.
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

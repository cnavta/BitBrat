import { spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import { BasePlugin, type AgentDetectionResult, type AgentConfig, type ProjectContext } from './base-plugin';

const exec = promisify(execCallback);

/**
 * Plugin for OpenHands (autonomous coding agent with web browsing).
 *
 * OpenHands (formerly OpenDevin) is an open-source autonomous agent
 * that can browse the web, write code, and interact with systems.
 *
 * Official site: https://www.all-hands.dev
 */
export class OpenHandsPlugin extends BasePlugin {
  readonly id = 'openhands';
  readonly name = 'OpenHands';
  readonly minVersion = '0.1.0';

  /**
   * Detect if OpenHands is installed.
   *
   * Checks for `openhands` command in PATH and verifies version.
   */
  async detect(): Promise<AgentDetectionResult> {
    try {
      // Check if openhands command exists
      const { stdout, stderr } = await exec('openhands --version');
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
      const { stdout: wherePath } = await exec(process.platform === 'win32' ? 'where openhands' : 'which openhands');
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
        issues: ['openhands command not found in PATH'],
      };
    }
  }

  /**
   * Prepare configuration for OpenHands.
   *
   * Configures OpenHands with BitBrat project context.
   */
  async prepareConfig(projectContext: ProjectContext): Promise<AgentConfig> {
    const args: string[] = [];
    const env: Record<string, string> = {};

    // Set workspace to project root
    args.push('--workspace', projectContext.root);

    // OpenHands can use context from the workspace
    // Documentation files will be available in the workspace

    // Configure git information if available
    if (projectContext.gitBranch) {
      env.GIT_BRANCH = projectContext.gitBranch;
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
      command: 'openhands',
      args,
      env,
      cwd,
      configFiles: [],
    };
  }

  /**
   * Launch OpenHands.
   *
   * Spawns the openhands process with prepared configuration.
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

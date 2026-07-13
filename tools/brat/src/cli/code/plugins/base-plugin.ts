import type { ChildProcess } from 'child_process';
import type { Architecture } from '../../../config/schema';

/**
 * Interface that all coding agent plugins must implement.
 *
 * Plugins provide integration with specific CLI coding agents (Claude Code, Aider, etc.)
 * and handle agent-specific configuration, detection, and launching.
 */
export interface CodingAgentPlugin {
  /** Unique identifier for the agent (e.g., 'claude-code', 'aider') */
  readonly id: string;

  /** Human-readable name (e.g., 'Claude Code', 'Aider') */
  readonly name: string;

  /** Minimum supported version (semver format) */
  readonly minVersion: string;

  /**
   * Detect if the agent is installed on the system.
   *
   * This method should:
   * - Check for the agent binary in PATH
   * - Execute --version command to verify installation
   * - Parse version output
   * - Return detection result with version and path
   *
   * @returns Promise resolving to detection result
   */
  detect(): Promise<AgentDetectionResult>;

  /**
   * Prepare agent-specific configuration.
   *
   * This method should:
   * - Generate config files (e.g., .claude/config.json)
   * - Prepare command-line arguments
   * - Set environment variables
   * - Inject project context (CLAUDE.md, architecture.yaml, etc.)
   * - Configure MCP if available
   *
   * @param projectContext - BitBrat project metadata and MCP environment
   * @returns Promise resolving to agent configuration
   */
  prepareConfig(projectContext: ProjectContext): Promise<AgentConfig>;

  /**
   * Launch the agent with prepared configuration.
   *
   * This method should:
   * - Spawn child process for the agent
   * - Apply prepared configuration
   * - Attach stdin/stdout/stderr to parent process
   * - Handle agent lifecycle (SIGTERM, SIGINT)
   *
   * @param config - Prepared agent configuration
   * @param args - Additional command-line arguments (pass-through flags)
   * @returns Promise resolving to spawned child process
   */
  launch(config: AgentConfig, args: string[]): Promise<ChildProcess>;

  /**
   * Optional pre-flight checks before launching agent.
   *
   * This method can:
   * - Verify API keys are set
   * - Check network connectivity
   * - Validate configuration
   * - Warn about missing dependencies
   *
   * @returns Promise resolving to preflight result (warnings, errors)
   */
  preflight?(): Promise<PreflightResult>;
}

/**
 * Result of agent detection (from detect() method).
 */
export interface AgentDetectionResult {
  /** Whether the agent is installed and detected */
  installed: boolean;

  /** Detected version string (if installed) */
  version?: string;

  /** Full path to agent binary (if found) */
  path?: string;

  /** Warnings or errors encountered during detection */
  issues?: string[];
}

/**
 * BitBrat project context passed to prepareConfig().
 *
 * Contains project metadata, documentation, and MCP environment information
 * needed to configure the coding agent with BitBrat-specific context.
 */
export interface ProjectContext {
  /** Absolute path to project root directory */
  root: string;

  /** Parsed architecture.yaml configuration */
  arch: Architecture;

  /** Contents of CLAUDE.md (if present) */
  claudeMd?: string;

  /** Contents of AGENTS.md (if present) */
  agentsMd?: string;

  /** Current git branch name */
  gitBranch?: string;

  /** Whether working directory has uncommitted changes */
  gitDirty?: boolean;

  /** MCP environment detection results (if available) */
  mcp?: McpEnvironment;
}

/**
 * MCP (Model Context Protocol) environment information.
 *
 * Describes the state of BitBrat's MCP tooling (tool-gateway, available tools)
 * to enable auto-configuration of coding agents with platform tools.
 */
export interface McpEnvironment {
  /** Whether MCP services are running and accessible */
  available: boolean;

  /** Tool gateway HTTP endpoint (e.g., http://localhost:8081) */
  toolGatewayUrl?: string;

  /** MCP authentication token */
  authToken?: string;

  /** List of discovered tool names from fleet API */
  discoveredTools?: string[];

  /** Running Bits detected in the fleet */
  bits?: Array<{
    name: string;
    url?: string;
    mcpExposure?: string;
  }>;
}

/**
 * Agent configuration prepared by prepareConfig().
 *
 * Contains all information needed to launch the agent, including
 * command, arguments, environment variables, and config files.
 */
export interface AgentConfig {
  /** Command to execute (e.g., 'claude', 'aider') */
  command: string;

  /** Command-line arguments */
  args: string[];

  /** Environment variables to set */
  env?: Record<string, string>;

  /** Working directory (defaults to project root) */
  cwd?: string;

  /** Config files to generate before launch */
  configFiles?: Array<{
    /** File path (absolute or relative to cwd) */
    path: string;

    /** File content to write */
    content: string;

    /** Whether to delete file after agent exits */
    temporary: boolean;
  }>;
}

/**
 * Result of pre-flight checks (from preflight() method).
 */
export interface PreflightResult {
  /** Whether pre-flight checks passed */
  success: boolean;

  /** Warning messages (non-fatal, user can proceed) */
  warnings?: string[];

  /** Error messages (fatal, should block launch) */
  errors?: string[];
}

/**
 * Abstract base class for coding agent plugins.
 *
 * Provides common utilities and helper methods that plugins can use.
 * Plugins can extend this class or implement CodingAgentPlugin directly.
 */
export abstract class BasePlugin implements CodingAgentPlugin {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly minVersion: string;

  abstract detect(): Promise<AgentDetectionResult>;
  abstract prepareConfig(projectContext: ProjectContext): Promise<AgentConfig>;
  abstract launch(config: AgentConfig, args: string[]): Promise<ChildProcess>;

  /**
   * Compare semantic version strings.
   *
   * @param version - Version to check (e.g., '1.2.3')
   * @param minVersion - Minimum required version (e.g., '1.0.0')
   * @returns True if version >= minVersion
   */
  protected compareVersions(version: string, minVersion: string): boolean {
    const v1Parts = version.split('.').map((n) => parseInt(n, 10));
    const v2Parts = minVersion.split('.').map((n) => parseInt(n, 10));

    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
      const v1 = v1Parts[i] || 0;
      const v2 = v2Parts[i] || 0;

      if (v1 > v2) return true;
      if (v1 < v2) return false;
    }

    return true; // Versions are equal
  }

  /**
   * Extract version string from command output.
   *
   * @param output - Command output (stdout or stderr)
   * @returns Extracted version string or null
   */
  protected extractVersion(output: string): string | null {
    // Match common version patterns: v1.2.3, 1.2.3, version 1.2.3
    const match = output.match(/v?(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  }
}

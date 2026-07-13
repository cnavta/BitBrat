import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';
import { loadArchitecture } from '../../../config/loader';
import type { ProjectContext } from '../plugins/base-plugin';

/**
 * Extract project context for coding agent configuration.
 *
 * Gathers all relevant project metadata, documentation, and environment state
 * needed to configure a coding agent with BitBrat-specific context.
 *
 * This includes:
 * - architecture.yaml configuration
 * - Documentation files (CLAUDE.md, AGENTS.md, README.md)
 * - Git status (branch, dirty state)
 * - MCP environment detection (if available)
 *
 * @param projectRoot - Absolute path to project root directory
 * @returns Promise resolving to project context
 * @throws Error if project root is invalid or architecture.yaml cannot be loaded
 */
export async function extractProjectContext(projectRoot: string): Promise<ProjectContext> {
  // Validate project root
  await validateProjectRoot(projectRoot);

  // Load architecture.yaml (required) - synchronous operation
  const arch = loadArchitecture(projectRoot);

  // Load documentation files (optional)
  const [claudeMd, agentsMd] = await Promise.all([
    readOptionalFile(path.join(projectRoot, 'CLAUDE.md')),
    readOptionalFile(path.join(projectRoot, 'AGENTS.md')),
  ]);

  // Extract git metadata
  const { gitBranch, gitDirty } = await extractGitStatus(projectRoot);

  // Detect MCP environment (stub for now, full implementation in BL-339-060)
  const mcp = await detectMcpEnvironment(projectRoot);

  return {
    root: projectRoot,
    arch,
    claudeMd,
    agentsMd,
    gitBranch,
    gitDirty,
    mcp,
  };
}

/**
 * Validate that the given path is a valid project root.
 *
 * Checks that:
 * - Path exists and is a directory
 * - Contains architecture.yaml file
 *
 * @param projectRoot - Path to validate
 * @throws Error if validation fails
 */
async function validateProjectRoot(projectRoot: string): Promise<void> {
  try {
    const stats = await fs.stat(projectRoot);
    if (!stats.isDirectory()) {
      throw new Error(`Project root is not a directory: ${projectRoot}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Project root does not exist: ${projectRoot}`);
    }
    throw err;
  }

  // Check for architecture.yaml
  const archPath = path.join(projectRoot, 'architecture.yaml');
  try {
    await fs.access(archPath, fs.constants.R_OK);
  } catch (err) {
    throw new Error(`Not a BitBrat project (missing architecture.yaml): ${projectRoot}`);
  }
}

/**
 * Read a file if it exists, return undefined if it doesn't.
 *
 * @param filePath - Absolute path to file
 * @returns File contents or undefined
 */
async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content.trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    // Other errors (permission, etc.) - log and return undefined
    console.debug(`Failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/**
 * Extract git metadata from project.
 *
 * Determines current branch name and whether working directory is dirty
 * (has uncommitted changes).
 *
 * @param projectRoot - Project root directory
 * @returns Git metadata or undefined values if not a git repo
 */
async function extractGitStatus(projectRoot: string): Promise<{
  gitBranch?: string;
  gitDirty?: boolean;
}> {
  try {
    // Get current branch name
    const gitBranch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    // Check if working directory is dirty
    const gitStatus = execSync('git status --porcelain', {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const gitDirty = gitStatus.trim().length > 0;

    return { gitBranch, gitDirty };
  } catch (err) {
    // Not a git repository or git command failed - not fatal
    console.debug(`Failed to extract git status: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

/**
 * Detect MCP environment for the project.
 *
 * STUB: Full implementation will be in BL-339-060.
 * For now, returns unavailable MCP environment.
 *
 * Future implementation will:
 * - Check if tool-gateway is running
 * - Discover available tools from fleet API
 * - Extract authentication token
 * - Detect running Bits with MCP exposure
 *
 * @param projectRoot - Project root directory
 * @returns MCP environment or null if unavailable
 */
async function detectMcpEnvironment(projectRoot: string): Promise<ProjectContext['mcp']> {
  // Stub implementation - always returns unavailable
  // Full implementation in BL-339-060
  return {
    available: false,
  };
}

/**
 * Get the default project root (current working directory).
 *
 * @returns Absolute path to current working directory
 */
export function getDefaultProjectRoot(): string {
  return process.cwd();
}

/**
 * Find the BitBrat project root by searching upwards from the given directory.
 *
 * Searches for architecture.yaml in the current directory and all parent directories
 * until found or filesystem root is reached.
 *
 * @param startDir - Directory to start search from (defaults to cwd)
 * @returns Absolute path to project root or null if not found
 */
export async function findProjectRoot(startDir: string = process.cwd()): Promise<string | null> {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const archPath = path.join(currentDir, 'architecture.yaml');

    try {
      await fs.access(archPath, fs.constants.R_OK);
      return currentDir; // Found it!
    } catch (err) {
      // Not found, try parent directory
      currentDir = path.dirname(currentDir);
    }
  }

  // Check root directory as well
  const archPath = path.join(root, 'architecture.yaml');
  try {
    await fs.access(archPath, fs.constants.R_OK);
    return root;
  } catch (err) {
    return null; // Not found anywhere
  }
}

/**
 * Format project context for display/logging.
 *
 * Creates a human-readable summary of project context for debugging
 * or user feedback.
 *
 * @param ctx - Project context
 * @returns Formatted string
 */
export function formatProjectContext(ctx: ProjectContext): string {
  const lines: string[] = [];

  lines.push(`Project: ${ctx.root}`);

  if (ctx.gitBranch) {
    const dirtyMarker = ctx.gitDirty ? ' (uncommitted changes)' : '';
    lines.push(`Git: ${ctx.gitBranch}${dirtyMarker}`);
  }

  if (ctx.claudeMd) {
    lines.push(`CLAUDE.md: ${ctx.claudeMd.length} bytes`);
  }

  if (ctx.agentsMd) {
    lines.push(`AGENTS.md: ${ctx.agentsMd.length} bytes`);
  }

  if (ctx.mcp?.available) {
    const toolCount = ctx.mcp.discoveredTools?.length || 0;
    lines.push(`MCP: ${toolCount} tools available`);
  }

  return lines.join('\n');
}

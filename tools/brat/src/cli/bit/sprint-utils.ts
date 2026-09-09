/**
 * Sprint awareness utilities
 * Sprint 23: Task 1.2
 *
 * Provides sprint status detection to enable sprint-aware behavior in brat commands.
 * Reads sprint-index.yaml to determine active sprint and guide users to work in
 * the appropriate worktree location.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { GitInfo } from './git-utils';

export interface SprintInfo {
  hasActiveSprint: boolean;
  sprintId: string | null;
  worktreePath: string | null;
  branch: string | null;
  status: string | null;
}

export interface SprintContextValidation {
  shouldWarn: boolean;
  message: string | null;
}

/**
 * Get information about active sprint from sprint-index.yaml
 *
 * @param repoRoot - Repository root path (from getGitRoot())
 * @returns Sprint information
 *
 * @example
 * const gitInfo = getGitInfo();
 * const sprintInfo = getSprintInfo(gitInfo.repoRoot!);
 * if (sprintInfo.hasActiveSprint) {
 *   console.log(`Active sprint: ${sprintInfo.sprintId}`);
 * }
 */
export function getSprintInfo(repoRoot: string): SprintInfo {
  try {
    const sprintIndexPath = path.join(repoRoot, 'planning', 'sprint-index.yaml');

    if (!fs.existsSync(sprintIndexPath)) {
      return {
        hasActiveSprint: false,
        sprintId: null,
        worktreePath: null,
        branch: null,
        status: null,
      };
    }

    const sprintIndexContent = fs.readFileSync(sprintIndexPath, 'utf8');
    const sprintIndex = yaml.load(sprintIndexContent) as any;

    if (!sprintIndex || !sprintIndex.sprints || !Array.isArray(sprintIndex.sprints)) {
      return {
        hasActiveSprint: false,
        sprintId: null,
        worktreePath: null,
        branch: null,
        status: null,
      };
    }

    // Find active sprint (status is 'planning' or 'in-progress')
    // Sprint-index.yaml has sprints as an array with id/status/worktreePath fields
    const activeSprint = sprintIndex.sprints.find((s: any) =>
      s.status === 'planning' || s.status === 'in-progress'
    );

    if (!activeSprint) {
      return {
        hasActiveSprint: false,
        sprintId: null,
        worktreePath: null,
        branch: null,
        status: null,
      };
    }

    // Use worktreePath from index, or calculate from repoRoot + worktreePath
    const worktreePath = activeSprint.worktreePath
      ? path.join(repoRoot, activeSprint.worktreePath)
      : path.join(repoRoot, '.worktrees', activeSprint.id);

    return {
      hasActiveSprint: true,
      sprintId: activeSprint.id,
      worktreePath,
      branch: activeSprint.branch || null,
      status: activeSprint.status,
    };
  } catch (error) {
    // Error reading/parsing sprint-index.yaml
    return {
      hasActiveSprint: false,
      sprintId: null,
      worktreePath: null,
      branch: null,
      status: null,
    };
  }
}

/**
 * Validate sprint context and generate warning if user is working outside
 * the active sprint worktree.
 *
 * @param gitInfo - Git repository information
 * @param sprintInfo - Sprint status information
 * @returns Validation result with warning message if applicable
 *
 * @example
 * const gitInfo = getGitInfo();
 * const sprintInfo = getSprintInfo(gitInfo.repoRoot!);
 * const validation = validateSprintContext(gitInfo, sprintInfo);
 * if (validation.shouldWarn) {
 *   console.warn(validation.message);
 * }
 */
export function validateSprintContext(
  gitInfo: GitInfo,
  sprintInfo: SprintInfo
): SprintContextValidation {
  // If no active sprint, no warning needed
  if (!sprintInfo.hasActiveSprint) {
    return { shouldWarn: false, message: null };
  }

  // If in worktree, check if it matches active sprint worktree
  if (gitInfo.isWorktree && gitInfo.repoRoot === sprintInfo.worktreePath) {
    return { shouldWarn: false, message: null };
  }

  // Warn if not in active sprint worktree
  const currentLocation = gitInfo.repoRoot || process.cwd();

  return {
    shouldWarn: true,
    message: `
⚠️  Active sprint detected: ${sprintInfo.sprintId}
   Sprint worktree: ${sprintInfo.worktreePath}
   Current location: ${currentLocation}

   Best practice: Create Bits in the sprint worktree during active sprints.

   To switch to sprint worktree:
     cd ${sprintInfo.worktreePath}
`,
  };
}

/**
 * Check if currently in the active sprint worktree
 *
 * @param currentPath - Current path (could be main repo or worktree)
 * @param mainRepoRoot - Main repository root (where planning/ directory lives)
 * @returns True if currentPath is the active sprint worktree, false otherwise
 *
 * @example
 * const gitInfo = getGitInfo();
 * // For worktrees, need to find main repo root separately
 * const mainRoot = gitInfo.isWorktree ? findMainRepoRoot(gitInfo.repoRoot) : gitInfo.repoRoot;
 * if (isInActiveSprintWorktree(gitInfo.repoRoot!, mainRoot!)) {
 *   console.log('Working in active sprint worktree');
 * }
 */
export function isInActiveSprintWorktree(currentPath: string, mainRepoRoot?: string): boolean {
  // If mainRepoRoot not provided, assume currentPath is main repo root
  const repoRootForIndex = mainRepoRoot || currentPath;
  const sprintInfo = getSprintInfo(repoRootForIndex);

  if (!sprintInfo.hasActiveSprint) {
    return false;
  }

  // Normalize paths for comparison (resolve removes trailing slashes and resolves ..)
  const normalizedCurrentPath = path.resolve(currentPath);
  const normalizedWorktreePath = path.resolve(sprintInfo.worktreePath!);

  return normalizedCurrentPath === normalizedWorktreePath;
}

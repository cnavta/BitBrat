/**
 * Git repository detection utilities
 * Sprint 23: Task 1.1
 *
 * Provides git-aware repository root detection to replace process.cwd()
 * and enable worktree-aware behavior in brat commands.
 */

import { execSync } from 'child_process';

export interface GitInfo {
  isGitRepo: boolean;
  repoRoot: string | null;
  isWorktree: boolean;
  worktreePath: string | null;
  currentBranch: string | null;
}

export interface GitValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Get comprehensive git repository information
 *
 * @returns GitInfo object with repository details
 *
 * @example
 * const gitInfo = getGitInfo();
 * if (gitInfo.isGitRepo) {
 *   console.log(`Repository root: ${gitInfo.repoRoot}`);
 *   console.log(`Is worktree: ${gitInfo.isWorktree}`);
 * }
 */
export function getGitInfo(): GitInfo {
  try {
    // Get repository root (works in both main repo and worktrees)
    const repoRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Check if in worktree by examining .git directory structure
    const gitDir = execSync('git rev-parse --git-dir', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Worktrees have .git files or .git/worktrees/ paths
    const isWorktree = gitDir.includes('.git/worktrees/') || gitDir.includes('/.git/worktrees/');

    // Get current branch (may be empty for detached HEAD)
    let currentBranch: string | null = null;
    try {
      currentBranch = execSync('git branch --show-current', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim() || null;
    } catch {
      // Detached HEAD or other issue, leave as null
      currentBranch = null;
    }

    return {
      isGitRepo: true,
      repoRoot,
      isWorktree,
      worktreePath: isWorktree ? repoRoot : null,
      currentBranch,
    };
  } catch (error) {
    // Not in a git repository or git command failed
    return {
      isGitRepo: false,
      repoRoot: null,
      isWorktree: false,
      worktreePath: null,
      currentBranch: null,
    };
  }
}

/**
 * Validate that current environment is a git repository
 *
 * @returns Validation result with errors if invalid
 *
 * @example
 * const validation = validateGitEnvironment();
 * if (!validation.valid) {
 *   console.error('Git errors:', validation.errors);
 *   process.exit(2);
 * }
 */
export function validateGitEnvironment(): GitValidationResult {
  const gitInfo = getGitInfo();
  const errors: string[] = [];

  if (!gitInfo.isGitRepo) {
    errors.push('Not in a git repository');
    errors.push('brat commands must be run from within the BitBrat repository');
    errors.push('');
    errors.push('To initialize a git repository:');
    errors.push('  git init');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get git repository root path
 *
 * This is the recommended replacement for process.cwd() in brat commands.
 * Returns the git repository root regardless of current working directory.
 *
 * @returns Repository root path
 * @throws Error if not in a git repository
 *
 * @example
 * const root = getGitRoot();
 * const filePath = path.join(root, 'src/apps/my-service.ts');
 */
export function getGitRoot(): string {
  const gitInfo = getGitInfo();

  if (!gitInfo.isGitRepo || !gitInfo.repoRoot) {
    throw new Error('Not in a git repository. brat commands must be run from within the repository.');
  }

  return gitInfo.repoRoot;
}

/**
 * Check if currently in a git worktree
 *
 * @returns True if in a worktree, false if in main repo or not in git repo
 *
 * @example
 * if (isInWorktree()) {
 *   console.log('Working in a git worktree');
 * }
 */
export function isInWorktree(): boolean {
  const gitInfo = getGitInfo();
  return gitInfo.isWorktree;
}

/**
 * Get current git branch name
 *
 * @returns Branch name or null if detached HEAD or not in git repo
 *
 * @example
 * const branch = getCurrentBranch();
 * if (branch) {
 *   console.log(`On branch: ${branch}`);
 * }
 */
export function getCurrentBranch(): string | null {
  const gitInfo = getGitInfo();
  return gitInfo.currentBranch;
}

/**
 * Unit tests for git-utils
 * Sprint 23: Task 3.1
 */

import { execSync } from 'child_process';
import {
  getGitInfo,
  validateGitEnvironment,
  getGitRoot,
  isInWorktree,
  getCurrentBranch,
} from './git-utils';

// Mock execSync
jest.mock('child_process');
const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

describe('git-utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getGitInfo', () => {
    it('should detect git repository in main repo', () => {
      mockExecSync
        .mockReturnValueOnce('/Users/test/repo\n' as any) // show-toplevel
        .mockReturnValueOnce('/Users/test/repo/.git\n' as any) // git-dir
        .mockReturnValueOnce('main\n' as any); // branch

      const result = getGitInfo();

      expect(result).toEqual({
        isGitRepo: true,
        repoRoot: '/Users/test/repo',
        isWorktree: false,
        worktreePath: null,
        currentBranch: 'main',
      });
    });

    it('should detect git worktree', () => {
      mockExecSync
        .mockReturnValueOnce('/Users/test/repo/.worktrees/sprint-23\n' as any) // show-toplevel
        .mockReturnValueOnce('/Users/test/repo/.git/worktrees/sprint-23\n' as any) // git-dir
        .mockReturnValueOnce('feature/sprint-23\n' as any); // branch

      const result = getGitInfo();

      expect(result).toEqual({
        isGitRepo: true,
        repoRoot: '/Users/test/repo/.worktrees/sprint-23',
        isWorktree: true,
        worktreePath: '/Users/test/repo/.worktrees/sprint-23',
        currentBranch: 'feature/sprint-23',
      });
    });

    it('should handle detached HEAD', () => {
      mockExecSync
        .mockReturnValueOnce('/Users/test/repo\n' as any) // show-toplevel
        .mockReturnValueOnce('/Users/test/repo/.git\n' as any) // git-dir
        .mockReturnValueOnce('\n' as any); // branch (empty for detached)

      const result = getGitInfo();

      expect(result.isGitRepo).toBe(true);
      expect(result.currentBranch).toBeNull();
    });

    it('should handle branch command failure', () => {
      mockExecSync
        .mockReturnValueOnce('/Users/test/repo\n' as any) // show-toplevel
        .mockReturnValueOnce('/Users/test/repo/.git\n' as any) // git-dir
        .mockImplementationOnce(() => {
          throw new Error('git branch failed');
        });

      const result = getGitInfo();

      expect(result.isGitRepo).toBe(true);
      expect(result.currentBranch).toBeNull();
    });

    it('should handle non-git directory', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not a git repository');
      });

      const result = getGitInfo();

      expect(result).toEqual({
        isGitRepo: false,
        repoRoot: null,
        isWorktree: false,
        worktreePath: null,
        currentBranch: null,
      });
    });

    it('should detect worktree with alternate .git path format', () => {
      mockExecSync
        .mockReturnValueOnce('/path/to/worktree\n' as any) // show-toplevel
        .mockReturnValueOnce('/main/repo/.git/worktrees/my-worktree\n' as any) // git-dir
        .mockReturnValueOnce('feature-branch\n' as any); // branch

      const result = getGitInfo();

      expect(result.isWorktree).toBe(true);
      expect(result.worktreePath).toBe('/path/to/worktree');
    });
  });

  describe('validateGitEnvironment', () => {
    it('should pass validation in git repository', () => {
      mockExecSync
        .mockReturnValueOnce('/Users/test/repo\n' as any)
        .mockReturnValueOnce('/Users/test/repo/.git\n' as any)
        .mockReturnValueOnce('main\n' as any);

      const result = validateGitEnvironment();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation in non-git directory', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not a git repository');
      });

      const result = validateGitEnvironment();

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Not in a git repository');
    });

    it('should provide helpful error messages', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not a git repository');
      });

      const result = validateGitEnvironment();

      expect(result.errors).toContain('Not in a git repository');
      expect(result.errors).toContain('brat commands must be run from within the BitBrat repository');
      expect(result.errors.some(e => e.includes('git init'))).toBe(true);
    });
  });

  describe('getGitRoot', () => {
    it('should return repository root in git repo', () => {
      mockExecSync
        .mockReturnValueOnce('/Users/test/repo\n' as any)
        .mockReturnValueOnce('/Users/test/repo/.git\n' as any)
        .mockReturnValueOnce('main\n' as any);

      const result = getGitRoot();

      expect(result).toBe('/Users/test/repo');
    });

    it('should return worktree root when in worktree', () => {
      mockExecSync
        .mockReturnValueOnce('/Users/test/repo/.worktrees/sprint-23\n' as any)
        .mockReturnValueOnce('/Users/test/repo/.git/worktrees/sprint-23\n' as any)
        .mockReturnValueOnce('feature/sprint-23\n' as any);

      const result = getGitRoot();

      expect(result).toBe('/Users/test/repo/.worktrees/sprint-23');
    });

    it('should throw error in non-git directory', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not a git repository');
      });

      expect(() => getGitRoot()).toThrow('Not in a git repository');
    });
  });

  describe('isInWorktree', () => {
    it('should return true when in worktree', () => {
      mockExecSync
        .mockReturnValueOnce('/Users/test/repo/.worktrees/sprint-23\n' as any)
        .mockReturnValueOnce('/Users/test/repo/.git/worktrees/sprint-23\n' as any)
        .mockReturnValueOnce('feature/sprint-23\n' as any);

      const result = isInWorktree();

      expect(result).toBe(true);
    });

    it('should return false when in main repo', () => {
      mockExecSync
        .mockReturnValueOnce('/Users/test/repo\n' as any)
        .mockReturnValueOnce('/Users/test/repo/.git\n' as any)
        .mockReturnValueOnce('main\n' as any);

      const result = isInWorktree();

      expect(result).toBe(false);
    });

    it('should return false when not in git repo', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not a git repository');
      });

      const result = isInWorktree();

      expect(result).toBe(false);
    });
  });

  describe('getCurrentBranch', () => {
    it('should return branch name when on branch', () => {
      mockExecSync
        .mockReturnValueOnce('/Users/test/repo\n' as any)
        .mockReturnValueOnce('/Users/test/repo/.git\n' as any)
        .mockReturnValueOnce('feature/my-feature\n' as any);

      const result = getCurrentBranch();

      expect(result).toBe('feature/my-feature');
    });

    it('should return null for detached HEAD', () => {
      mockExecSync
        .mockReturnValueOnce('/Users/test/repo\n' as any)
        .mockReturnValueOnce('/Users/test/repo/.git\n' as any)
        .mockReturnValueOnce('\n' as any);

      const result = getCurrentBranch();

      expect(result).toBeNull();
    });

    it('should return null when not in git repo', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not a git repository');
      });

      const result = getCurrentBranch();

      expect(result).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle paths with spaces', () => {
      mockExecSync
        .mockReturnValueOnce('/Users/test/my repo/project\n' as any)
        .mockReturnValueOnce('/Users/test/my repo/project/.git\n' as any)
        .mockReturnValueOnce('main\n' as any);

      const result = getGitInfo();

      expect(result.repoRoot).toBe('/Users/test/my repo/project');
    });

    it('should trim whitespace from git command output', () => {
      mockExecSync
        .mockReturnValueOnce('  /Users/test/repo  \n' as any)
        .mockReturnValueOnce('  /Users/test/repo/.git  \n' as any)
        .mockReturnValueOnce('  main  \n' as any);

      const result = getGitInfo();

      expect(result.repoRoot).toBe('/Users/test/repo');
      expect(result.currentBranch).toBe('main');
    });

    it('should handle Windows-style paths with worktrees', () => {
      mockExecSync
        .mockReturnValueOnce('C:/Users/test/repo/.worktrees/sprint-23\n' as any) // Git normalizes to forward slashes
        .mockReturnValueOnce('C:/Users/test/repo/.git/worktrees/sprint-23\n' as any)
        .mockReturnValueOnce('feature\n' as any);

      const result = getGitInfo();

      expect(result.isWorktree).toBe(true);
    });
  });
});

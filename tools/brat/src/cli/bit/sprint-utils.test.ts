/**
 * Unit tests for sprint-utils
 * Sprint 23: Task 3.2
 */

import fs from 'fs';
import path from 'path';
import {
  getSprintInfo,
  validateSprintContext,
  isInActiveSprintWorktree,
} from './sprint-utils';
import type { GitInfo } from './git-utils';

// Mock fs
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('sprint-utils', () => {
  const mockRepoRoot = '/Users/test/repo';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getSprintInfo', () => {
    it('should detect active sprint in planning status', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        `sprints:
  - id: sprint-23-abc123
    status: planning
    branch: feature/sprint-23
    title: Test Sprint
    worktreePath: .worktrees/sprint-23-abc123
`
      );

      const result = getSprintInfo(mockRepoRoot);

      expect(result).toEqual({
        hasActiveSprint: true,
        sprintId: 'sprint-23-abc123',
    worktreePath: '/Users/test/repo/.worktrees/sprint-23-abc123',
    branch: 'feature/sprint-23',
    status: 'planning',
      });
    });

    it('should detect active sprint in in-progress status', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        `sprints:
  - id: sprint-24-xyz789
    status: in-progress
    branch: feature/sprint-24
    title: Another Sprint
    worktreePath: .worktrees/sprint-24-xyz789
`
      );

      const result = getSprintInfo(mockRepoRoot);

      expect(result.hasActiveSprint).toBe(true);
      expect(result.sprintId).toBe('sprint-24-xyz789');
      expect(result.status).toBe('in-progress');
    });

    it('should return no active sprint when all sprints completed', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        `sprints:
  - id: sprint-22-old123
    status: complete
    branch: feature/sprint-22
  - id: sprint-21-old456
    status: complete
    branch: feature/sprint-21
`
      );

      const result = getSprintInfo(mockRepoRoot);

      expect(result).toEqual({
        hasActiveSprint: false,
        sprintId: null,
    worktreePath: null,
    branch: null,
    status: null,
      });
    });

    it('should handle missing sprint-index.yaml', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = getSprintInfo(mockRepoRoot);

      expect(result.hasActiveSprint).toBe(false);
      expect(result.sprintId).toBeNull();
    });

    it('should handle malformed YAML', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid: yaml: content: [[[');

      const result = getSprintInfo(mockRepoRoot);

      expect(result.hasActiveSprint).toBe(false);
    });

    it('should handle empty sprint-index.yaml', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('');

      const result = getSprintInfo(mockRepoRoot);

      expect(result.hasActiveSprint).toBe(false);
    });

    it('should handle sprint-index with no sprints key', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('version: 1.0\notherKey: value');

      const result = getSprintInfo(mockRepoRoot);

      expect(result.hasActiveSprint).toBe(false);
    });

    it('should prefer first active sprint if multiple exist', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        `sprints:
  - id: sprint-23-first
    status: planning
    branch: feature/sprint-23
  - id: sprint-24-second
    status: in-progress
    branch: feature/sprint-24
`
      );

      const result = getSprintInfo(mockRepoRoot);

      // Should return the first one encountered (sprint-23)
      expect(result.sprintId).toBe('sprint-23-first');
      expect(result.status).toBe('planning');
    });

    it('should handle sprint without branch field', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        `sprints:
  - id: sprint-23-nobranch
    status: planning
    title: Sprint Without Branch
`
      );

      const result = getSprintInfo(mockRepoRoot);

      expect(result.hasActiveSprint).toBe(true);
      expect(result.branch).toBeNull();
    });

    it('should calculate correct worktree path', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        `sprints:
  - id: sprint-25-test
    status: planning
`
      );

      const result = getSprintInfo(mockRepoRoot);

      expect(result.worktreePath).toBe('/Users/test/repo/.worktrees/sprint-25-test');
    });
  });

  describe('validateSprintContext', () => {
    const mockGitInfo: GitInfo = {
      isGitRepo: true,
      repoRoot: mockRepoRoot,
      isWorktree: false,
    worktreePath: null,
      currentBranch: 'main',
    };

    it('should not warn when no active sprint', () => {
      const sprintInfo = {
        hasActiveSprint: false,
        sprintId: null,
    worktreePath: null,
    branch: null,
    status: null,
      };

      const result = validateSprintContext(mockGitInfo, sprintInfo);

      expect(result.shouldWarn).toBe(false);
      expect(result.message).toBeNull();
    });

    it('should not warn when in active sprint worktree', () => {
      const gitInfo: GitInfo = {
        isGitRepo: true,
        repoRoot: '/Users/test/repo/.worktrees/sprint-23-abc123',
        isWorktree: true,
    worktreePath: '/Users/test/repo/.worktrees/sprint-23-abc123',
        currentBranch: 'feature/sprint-23',
      };

      const sprintInfo = {
        hasActiveSprint: true,
        sprintId: 'sprint-23-abc123',
    worktreePath: '/Users/test/repo/.worktrees/sprint-23-abc123',
    branch: 'feature/sprint-23',
    status: 'in-progress',
      };

      const result = validateSprintContext(gitInfo, sprintInfo);

      expect(result.shouldWarn).toBe(false);
      expect(result.message).toBeNull();
    });

    it('should warn when in main repo with active sprint', () => {
      const sprintInfo = {
        hasActiveSprint: true,
        sprintId: 'sprint-23-abc123',
    worktreePath: '/Users/test/repo/.worktrees/sprint-23-abc123',
    branch: 'feature/sprint-23',
    status: 'planning',
      };

      const result = validateSprintContext(mockGitInfo, sprintInfo);

      expect(result.shouldWarn).toBe(true);
      expect(result.message).toContain('Active sprint detected');
      expect(result.message).toContain('sprint-23-abc123');
      expect(result.message).toContain('.worktrees/sprint-23-abc123');
    });

    it('should warn when in different worktree', () => {
      const gitInfo: GitInfo = {
        isGitRepo: true,
        repoRoot: '/Users/test/repo/.worktrees/sprint-22-old',
        isWorktree: true,
    worktreePath: '/Users/test/repo/.worktrees/sprint-22-old',
        currentBranch: 'feature/sprint-22',
      };

      const sprintInfo = {
        hasActiveSprint: true,
        sprintId: 'sprint-23-abc123',
    worktreePath: '/Users/test/repo/.worktrees/sprint-23-abc123',
    branch: 'feature/sprint-23',
    status: 'in-progress',
      };

      const result = validateSprintContext(gitInfo, sprintInfo);

      expect(result.shouldWarn).toBe(true);
      expect(result.message).toContain('Active sprint detected');
    });

    it('should include helpful instructions in warning', () => {
      const sprintInfo = {
        hasActiveSprint: true,
        sprintId: 'sprint-23-abc123',
    worktreePath: '/Users/test/repo/.worktrees/sprint-23-abc123',
    branch: 'feature/sprint-23',
    status: 'planning',
      };

      const result = validateSprintContext(mockGitInfo, sprintInfo);

      expect(result.message).toContain('cd');
      expect(result.message).toContain('Best practice');
      expect(result.message).toContain('sprint worktree');
    });
  });

  describe('isInActiveSprintWorktree', () => {
    it('should return true when in active sprint worktree', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        `sprints:
  - id: sprint-23-abc123
    status: planning
`
      );

      const worktreePath = '/Users/test/repo/.worktrees/sprint-23-abc123';
      const result = isInActiveSprintWorktree(worktreePath, mockRepoRoot);

      expect(result).toBe(true);
    });

    it('should return false when in main repo', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        `sprints:
  - id: sprint-23-abc123
    status: planning
`
      );

      const result = isInActiveSprintWorktree(mockRepoRoot, mockRepoRoot);

      expect(result).toBe(false);
    });

    it('should return false when no active sprint', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        `sprints:
  - id: sprint-22-old
    status: complete
`
      );

      const result = isInActiveSprintWorktree(mockRepoRoot, mockRepoRoot);

      expect(result).toBe(false);
    });

    it('should return false when in different worktree', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        `sprints:
  - id: sprint-23-current
    status: planning
`
      );

      const differentWorktree = '/Users/test/repo/.worktrees/sprint-22-old';
      const result = isInActiveSprintWorktree(differentWorktree, mockRepoRoot);

      expect(result).toBe(false);
    });

    it('should handle path normalization', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        `sprints:
  - id: sprint-23-abc123
    status: planning
`
      );

      // Test with trailing slashes and ./ notation
      const pathWithTrailingSlash = '/Users/test/repo/.worktrees/sprint-23-abc123/';
      const result = isInActiveSprintWorktree(pathWithTrailingSlash, mockRepoRoot);

      expect(result).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle fs.readFileSync throwing error', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = getSprintInfo(mockRepoRoot);

      expect(result.hasActiveSprint).toBe(false);
    });

    it('should handle fs.existsSync throwing error', () => {
      mockFs.existsSync.mockImplementation(() => {
        throw new Error('Disk error');
      });

      const result = getSprintInfo(mockRepoRoot);

      expect(result.hasActiveSprint).toBe(false);
    });
  });
});

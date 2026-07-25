/**
 * Release Command Tests
 * Sprint 359: Integration tests for brat release command
 */

import { test } from '@oclif/test';
import Release from './release';
import { runRelease, ReleaseResult } from '../release';
import { ConfigurationError } from '../orchestration/errors';

// Mock dependencies
jest.mock('../release');
jest.mock('../orchestration/errors');

const mockRunRelease = runRelease as jest.MockedFunction<typeof runRelease>;

describe('brat release', () => {
  let mockReleaseResult: ReleaseResult;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock successful release result
    mockReleaseResult = {
      previousVersion: '0.16.4',
      nextVersion: '0.17.0',
      uncommittedChanges: false,
      changesCommitted: true,
      changelogRolled: true,
      tagged: true,
      pushed: true,
      prCreated: true,
      prUrl: 'https://github.com/user/repo/pull/123',
      consistency: {
        ok: true,
        architecture: '0.17.0',
        packageJson: '0.17.0',
        packageLock: '0.17.0',
      },
    };

    mockRunRelease.mockResolvedValue(mockReleaseResult);
  });

  describe('Version Bump Types', () => {
    test
      .stdout()
      .command(['release', 'patch'])
      .it('should accept patch bump', () => {
        expect(mockRunRelease).toHaveBeenCalledWith(
          expect.objectContaining({
            bump: 'patch',
          })
        );
      });

    test
      .stdout()
      .command(['release', 'minor'])
      .it('should accept minor bump', () => {
        expect(mockRunRelease).toHaveBeenCalledWith(
          expect.objectContaining({
            bump: 'minor',
          })
        );
      });

    test
      .stdout()
      .command(['release', 'major'])
      .it('should accept major bump', () => {
        expect(mockRunRelease).toHaveBeenCalledWith(
          expect.objectContaining({
            bump: 'major',
          })
        );
      });

    test
      .stdout()
      .command(['release', '1.2.3'])
      .it('should accept explicit x.y.z version', () => {
        expect(mockRunRelease).toHaveBeenCalledWith(
          expect.objectContaining({
            bump: '1.2.3',
          })
        );
      });

    test
      .stdout()
      .command(['release', 'invalid'])
      .catch((error) => {
        expect(error.message).toContain('Invalid bump argument');
        expect(error.message).toContain('patch, minor, major');
      })
      .it('should reject invalid bump type');

    test
      .stdout()
      .command(['release', '1.2'])
      .catch((error) => {
        expect(error.message).toContain('Invalid bump argument');
      })
      .it('should reject invalid version format');
  });

  describe('Dry Run Mode', () => {
    test
      .stdout()
      .command(['release', 'patch', '--dry-run'])
      .it('should run in dry-run mode without mutations', (ctx) => {
        expect(mockRunRelease).toHaveBeenCalledWith(
          expect.objectContaining({
            dryRun: true,
          })
        );
        expect(ctx.stdout).toContain('[DRY-RUN]');
        expect(ctx.stdout).toContain('No changes were made');
      });

    test
      .stdout()
      .command(['release', '2.0.0', '--dry-run'])
      .it('should preview version changes in dry-run', (ctx) => {
        expect(ctx.stdout).toContain('Previous version');
        expect(ctx.stdout).toContain('Next version');
      });
  });

  describe('Git Operations Flags', () => {
    test
      .stdout()
      .command(['release', 'patch', '--no-tag'])
      .it('should skip git tag creation with --no-tag', () => {
        expect(mockRunRelease).toHaveBeenCalledWith(
          expect.objectContaining({
            tag: false,
          })
        );
      });

    test
      .stdout()
      .command(['release', 'patch', '--no-push'])
      .it('should skip git push with --no-push', () => {
        expect(mockRunRelease).toHaveBeenCalledWith(
          expect.objectContaining({
            push: false,
          })
        );
      });

    test
      .stdout()
      .command(['release', 'patch', '--no-pr'])
      .it('should skip GitHub PR creation with --no-pr', () => {
        expect(mockRunRelease).toHaveBeenCalledWith(
          expect.objectContaining({
            createPr: false,
          })
        );
      });

    test
      .stdout()
      .command(['release', 'patch', '--no-tag', '--no-push', '--no-pr'])
      .it('should allow combining multiple no-* flags', () => {
        expect(mockRunRelease).toHaveBeenCalledWith(
          expect.objectContaining({
            tag: false,
            push: false,
            createPr: false,
          })
        );
      });
  });

  describe('Validation Rules', () => {
    test
      .stdout()
      .command(['release', 'patch', '--no-tag', '--no-pr'])
      .it('should allow --no-pr when --no-tag is also set', () => {
        // This combination is valid
        expect(mockRunRelease).toHaveBeenCalled();
      });

    test
      .stdout()
      .do(() => {
        // Mock the validation error
        mockRunRelease.mockImplementation(() => {
          throw new ConfigurationError(
            'GitHub PRs require git tags. Remove --no-tag or add --no-pr.'
          );
        });
      })
      .command(['release', 'patch', '--no-tag'])
      .catch((error) => {
        expect(error.message).toContain('GitHub PRs require git tags');
      })
      .it('should reject --no-tag without --no-pr');
  });

  describe('Yes Flag (Skip Prompts)', () => {
    test
      .stdout()
      .command(['release', 'patch', '--yes'])
      .it('should skip all prompts with --yes flag', () => {
        expect(mockRunRelease).toHaveBeenCalledWith(
          expect.objectContaining({
            yes: true,
          })
        );
      });

    test
      .stdout()
      .command(['release', 'patch', '-y'])
      .it('should accept -y shorthand for --yes', () => {
        expect(mockRunRelease).toHaveBeenCalledWith(
          expect.objectContaining({
            yes: true,
          })
        );
      });
  });

  describe('Results Display', () => {
    test
      .stdout()
      .command(['release', 'patch'])
      .it('should display release summary', (ctx) => {
        expect(ctx.stdout).toContain('Release Summary');
        expect(ctx.stdout).toContain('Previous version: 0.16.4');
        expect(ctx.stdout).toContain('Next version:     0.17.0');
      });

    test
      .stdout()
      .command(['release', 'patch'])
      .it('should display updated files', (ctx) => {
        expect(ctx.stdout).toContain('Files updated:');
        expect(ctx.stdout).toContain('architecture.yaml');
        expect(ctx.stdout).toContain('package.json');
        expect(ctx.stdout).toContain('package-lock.json');
      });

    test
      .stdout()
      .do(() => {
        mockReleaseResult.changelogRolled = true;
      })
      .command(['release', 'patch'])
      .it('should display changelog update when rolled', (ctx) => {
        expect(ctx.stdout).toContain('CHANGELOG.md');
        expect(ctx.stdout).toContain('0.17.0');
      });

    test
      .stdout()
      .do(() => {
        mockReleaseResult.tagged = true;
        mockReleaseResult.pushed = true;
        mockReleaseResult.prCreated = true;
      })
      .command(['release', 'patch'])
      .it('should display git operations summary', (ctx) => {
        expect(ctx.stdout).toContain('Git tag created: v0.17.0');
        expect(ctx.stdout).toContain('Changes pushed to remote');
        expect(ctx.stdout).toContain('GitHub PR created');
      });

    test
      .stdout()
      .command(['release', 'patch'])
      .it('should display version consistency check', (ctx) => {
        expect(ctx.stdout).toContain('Version consistency check:');
        expect(ctx.stdout).toContain('architecture.yaml: 0.17.0');
        expect(ctx.stdout).toContain('package.json:      0.17.0');
        expect(ctx.stdout).toContain('package-lock.json: 0.17.0');
        expect(ctx.stdout).toContain('✓ All files consistent');
      });

    test
      .stdout()
      .command(['release', 'patch'])
      .it('should display completion message', (ctx) => {
        expect(ctx.stdout).toContain('✓ Release 0.17.0 complete!');
      });
  });

  describe('Error Handling', () => {
    test
      .stdout()
      .do(() => {
        mockRunRelease.mockRejectedValue(
          new Error('Git repository has uncommitted changes')
        );
      })
      .command(['release', 'patch'])
      .catch((error) => {
        expect(error.message).toContain('uncommitted changes');
      })
      .it('should handle uncommitted changes error');

    test
      .stdout()
      .do(() => {
        mockRunRelease.mockRejectedValue(
          new Error('Failed to update architecture.yaml')
        );
      })
      .command(['release', 'patch'])
      .catch((error) => {
        expect(error.message).toContain('architecture.yaml');
      })
      .it('should handle file update errors');

    test
      .stdout()
      .do(() => {
        mockRunRelease.mockRejectedValue(
          new ConfigurationError('Invalid version format')
        );
      })
      .command(['release', '1.0'])
      .catch((error) => {
        expect(error.message).toContain('Invalid');
      })
      .it('should handle configuration errors');
  });

  describe('Context Integration', () => {
    test
      .stdout()
      .command(['release', 'patch', '--context=local'])
      .it('should accept --context flag from BratCommand');

    test
      .stdout()
      .command(['release', 'patch', '--verbose'])
      .it('should accept --verbose flag from BratCommand');
  });

  describe('Help Text', () => {
    test
      .stdout()
      .command(['release', '--help'])
      .it('should display help text', (ctx) => {
        expect(ctx.stdout).toContain('Cut a platform version release');
        expect(ctx.stdout).toContain('ARGUMENTS');
        expect(ctx.stdout).toContain('BUMP');
        expect(ctx.stdout).toContain('--dry-run');
        expect(ctx.stdout).toContain('--no-tag');
        expect(ctx.stdout).toContain('--no-push');
        expect(ctx.stdout).toContain('--no-pr');
        expect(ctx.stdout).toContain('--yes');
      });

    test
      .stdout()
      .command(['release', '--help'])
      .it('should show examples in help text', (ctx) => {
        expect(ctx.stdout).toContain('EXAMPLES');
      });
  });

  describe('Logging', () => {
    test
      .stdout()
      .command(['release', 'patch', '--verbose'])
      .it('should enable debug logging with --verbose', () => {
        expect(mockRunRelease).toHaveBeenCalledWith(
          expect.objectContaining({
            logger: expect.any(Object),
          })
        );
      });
  });

  describe('Repository Root Resolution', () => {
    test
      .stdout()
      .command(['release', 'patch'])
      .it('should pass repository root to runRelease', () => {
        expect(mockRunRelease).toHaveBeenCalledWith(
          expect.objectContaining({
            rootDir: expect.any(String),
          })
        );
      });
  });

  describe('Dry Run Output Formatting', () => {
    test
      .stdout()
      .command(['release', 'patch', '--dry-run'])
      .it('should prefix all output with [DRY-RUN]', (ctx) => {
        expect(ctx.stdout).toContain('[DRY-RUN]');
      });

    test
      .stdout()
      .do(() => {
        mockReleaseResult.changelogRolled = true;
      })
      .command(['release', 'patch', '--dry-run'])
      .it('should show changelog operation as dry-run', (ctx) => {
        expect(ctx.stdout).toContain('[DRY-RUN]');
        expect(ctx.stdout).toContain('CHANGELOG.md');
      });
  });

  describe('PR URL Display', () => {
    test
      .stdout()
      .do(() => {
        mockReleaseResult.prCreated = true;
        mockReleaseResult.prUrl =
          'https://github.com/user/repo/pull/456';
      })
      .command(['release', 'patch'])
      .it('should display PR URL when PR is created', (ctx) => {
        expect(ctx.stdout).toContain(
          'https://github.com/user/repo/pull/456'
        );
      });

    test
      .stdout()
      .do(() => {
        mockReleaseResult.prCreated = false;
        mockReleaseResult.prUrl = undefined;
      })
      .command(['release', 'patch', '--no-pr'])
      .it('should not display PR URL when PR not created', (ctx) => {
        expect(ctx.stdout).not.toContain('github.com');
      });
  });

  describe('Uncommitted Changes Handling', () => {
    test
      .stdout()
      .do(() => {
        mockReleaseResult.uncommittedChanges = true;
        mockReleaseResult.changesCommitted = true;
      })
      .command(['release', 'patch'])
      .it('should report uncommitted changes were committed', (ctx) => {
        expect(ctx.stdout).toContain('Uncommitted changes: committed');
      });
  });

  describe('Argument Validation', () => {
    test
      .stdout()
      .command(['release'])
      .catch((error) => {
        expect(error.message).toMatch(/missing.*argument|required/i);
      })
      .it('should require bump argument');

    test
      .stdout()
      .command(['release', 'patch', 'extra-arg'])
      .catch((error) => {
        expect(error.message).toMatch(/unexpected.*argument/i);
      })
      .it('should reject extra arguments');
  });
});

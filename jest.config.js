/**
 * Jest configuration
 * - Keep defaults for local/dev
 * - In CI (e.g., Cloud Build), avoid worker_threads and limit concurrency to mitigate random segfaults
 *   observed with Node 20+/24 and ts-jest on some platforms.
 */

// Helper: Check if Docker is available
function hasDocker() {
  try {
    const { execSync } = require('child_process');
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

module.exports = () => {
  // Sprint 30: Tests can now run from worktrees thanks to rootDir + roots configuration!
  // The 'roots' config below prevents Jest from traversing up to discover other worktrees.
  // No blocking needed - the configuration solves the root cause.

  /** @type {import('ts-jest').JestConfigWithTsJest} */
  const base = {
    preset: 'ts-jest',
    testEnvironment: 'node',

    // CRITICAL (Sprint 30): Scope Jest to prevent worktree traversal
    // Without these, Jest traverses up from worktrees and discovers ALL worktrees in repo
    // This caused 1,800+ duplicate tests and 8+ min runtimes
    // With this config: tests run correctly from both main repo AND worktrees
    rootDir: '.',
    roots: ['<rootDir>/src', '<rootDir>/tests', '<rootDir>/tools'],
    setupFilesAfterEnv: ['<rootDir>/test-setup.js'],
    testPathIgnorePatterns: [
      '/node_modules/',
      '/dist/',
      '/deprecated/',
      // NOTE: Removed '\.worktrees' - no longer needed since 'roots' config scopes search
      // The old pattern would exclude ALL tests when running from a worktree!
      '/tools/brat/src/oclif-commands/',
      'stream-analyst-service.test.ts', // Deprecated service (replaced by event-stream-analyzer)
    ],
    moduleNameMapper: {
      '^(\\.{1,2}/.*)\\.js$': '$1',
    },
  };

  const isCI = !!process.env.CI || process.env.CLOUD_BUILD === '1' || process.env.BUILDKITE === 'true' || !!process.env.BUILD_ID;

  // Quick Win (Sprint 30+31): Skip Docker tests when Docker unavailable
  // Prevents infrastructure test failures in CI or local environments without Docker
  // Sprint 31: Extended to apply to local development, not just CI
  if (!hasDocker()) {
    console.log('⏭️  Docker unavailable - skipping E2E tests requiring Docker');
    base.testPathIgnorePatterns.push(
      'agent-dev-e2e.test.ts',
      'jetstream-validation.test.ts',
      'docker-compose.*\\.test\\.ts'
    );
  }
  if (isCI) {
    // Skip Redis integration tests in CI by default (Redis not available in build containers)
    if (!process.env.SKIP_REDIS_TESTS) {
      process.env.SKIP_REDIS_TESTS = 'true';
    }
    return {
      ...base,
      // Run tests in a single worker and disable worker_threads to improve stability in CI containers
      maxWorkers: 1,
      workerThreads: false,
      detectOpenHandles: true,
      // In CI, force process exit after tests complete to avoid timeouts from lingering async handles
      forceExit: true,
    };
  }
  return base;
};
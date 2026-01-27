/**
 * Jest configuration
 * - Keep defaults for local/dev
 * - In CI (e.g., Cloud Build), avoid worker_threads and limit concurrency to mitigate random segfaults
 *   observed with Node 20+/24 and ts-jest on some platforms.
 */
module.exports = () => {
  /** @type {import('ts-jest').JestConfigWithTsJest} */
  const base = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testPathIgnorePatterns: ['/node_modules/', '/dist/', '/deprecated/'],
  };

  const isCI = !!process.env.CI || process.env.CLOUD_BUILD === '1' || process.env.BUILDKITE === 'true' || !!process.env.BUILD_ID;
  if (isCI) {
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
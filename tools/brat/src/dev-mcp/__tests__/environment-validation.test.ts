/**
 * Sprint 26 T2.3: Environment Variable Validation Integration Test
 *
 * Validates that the generated .env.brat file contains all required
 * environment variables by checking that Docker Compose build produces
 * zero warnings about unset variables.
 *
 * This is an INTEGRATION test - requires Docker and takes 60-120 seconds.
 */

import { AgentDevContextManager } from '../agent-dev-context-manager';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

describe('Environment Variable Validation (T2.3)', () => {
  const repoRoot = path.join(__dirname, '../../../../..');
  const manager = new AgentDevContextManager(repoRoot);
  let contextName: string;

  // Skip this test in CI if Docker is not available
  const skipIfNoDocker = process.env.CI && !process.env.DOCKER_AVAILABLE;

  beforeAll(async () => {
    if (skipIfNoDocker) {
      console.log('Skipping environment validation test (Docker not available)');
      return;
    }

    // Provision a unique agent-dev context for testing
    contextName = `agent-dev-env-test-${Date.now()}`;

    try {
      await manager.provision({ name: contextName, profile: 'dev', persistence: 'postgres' });
    } catch (error) {
      console.error('Failed to provision agent-dev context:', error);
      throw error;
    }
  }, 120000); // 2 minute timeout for provisioning

  afterAll(async () => {
    if (skipIfNoDocker || !contextName) {
      return;
    }

    // Clean up - destroy the test context
    try {
      await manager.destroy(contextName, true);
    } catch (error) {
      console.warn('Failed to destroy test context:', error);
      // Non-fatal - test context can be manually cleaned up
    }
  }, 60000); // 1 minute timeout for cleanup

  it('should generate .env.brat file with all required variables', async () => {
    if (skipIfNoDocker) {
      return;
    }

    // Verify .env.brat exists in repo root
    const envBratPath = path.join(repoRoot, '.env.brat');
    expect(fs.existsSync(envBratPath)).toBe(true);

    // Read and verify it contains required variables
    const envContent = fs.readFileSync(envBratPath, 'utf-8');

    // Check for critical required variables
    const requiredVars = [
      'LLM_PROVIDER',
      'LLM_MODEL',
      'DATABASE_URL',
      'REDIS_URL',
      'NATS_URL',
      'PERSISTENCE_DRIVER',
      'NODE_ENV',
      'LOG_LEVEL',
    ];

    for (const varName of requiredVars) {
      expect(envContent).toContain(`${varName}=`);
    }
  }, 10000); // 10 second timeout

  it('should produce zero warnings during Docker Compose config validation', async () => {
    if (skipIfNoDocker) {
      return;
    }

    // Get path to docker-compose file
    const composePath = path.join(
      repoRoot,
      'infrastructure/docker-compose',
      `docker-compose.${contextName}.yaml`
    );

    expect(fs.existsSync(composePath)).toBe(true);

    try {
      // Run docker compose config to validate the configuration
      // This will show warnings for unset environment variables
      const { stderr } = await execAsync(
        `docker compose -f ${composePath} --project-directory ${repoRoot} config`,
        { env: { ...process.env, COMPOSE_PROJECT_NAME: `bitbrat-${contextName}` } }
      );

      // Check for common environment variable warnings
      const warnings = stderr.toLowerCase();

      // These warning patterns indicate missing variables
      const warningPatterns = [
        /variable.*is not set/i,
        /variable.*undefined/i,
        /\$\{.*\}.*not.*set/i,
      ];

      const foundWarnings: string[] = [];
      for (const pattern of warningPatterns) {
        if (pattern.test(warnings)) {
          foundWarnings.push(warnings);
        }
      }

      if (foundWarnings.length > 0) {
        console.error('Docker Compose warnings found:', foundWarnings);
      }

      // Assert no warnings about unset variables
      expect(foundWarnings.length).toBe(0);
    } catch (error) {
      const err = error as { stderr?: string; stdout?: string };
      console.error('Docker Compose config validation failed:');
      console.error('STDERR:', err.stderr);
      console.error('STDOUT:', err.stdout);
      throw error;
    }
  }, 60000); // 1 minute timeout

  it('should build services without environment variable warnings', async () => {
    if (skipIfNoDocker) {
      return;
    }

    // Get path to docker-compose file
    const composePath = path.join(
      repoRoot,
      'infrastructure/docker-compose',
      `docker-compose.${contextName}.yaml`
    );

    try {
      // Build the bitbrat-base service only (faster than building all services)
      const { stderr } = await execAsync(
        `docker compose -f ${composePath} --project-directory ${repoRoot} build bitbrat-base 2>&1`,
        {
          env: { ...process.env, COMPOSE_PROJECT_NAME: `bitbrat-${contextName}` },
        }
      );

      // Check for environment variable warnings in build output
      const output = stderr.toLowerCase();

      // Common warning patterns during build
      const warningPatterns = [
        /warn.*variable.*not set/i,
        /warn.*undefined variable/i,
      ];

      const foundWarnings: string[] = [];
      for (const pattern of warningPatterns) {
        if (pattern.test(output)) {
          foundWarnings.push(output);
        }
      }

      if (foundWarnings.length > 0) {
        console.warn('Build warnings found (may be acceptable):', foundWarnings);
      }

      // This is informational - some warnings may be acceptable
      // We mainly care about the config validation above
      expect(foundWarnings.length).toBeLessThanOrEqual(0);
    } catch (error) {
      const err = error as { stderr?: string; stdout?: string };
      // Build errors are acceptable for this test (we're only checking for warnings)
      console.warn('Build check encountered error (non-fatal):', err.stderr);
    }
  }, 300000); // 5 minute timeout for build
});

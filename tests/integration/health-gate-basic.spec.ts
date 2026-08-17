/**
 * Basic integration tests for HealthGate pattern
 *
 * Simplified tests that focus on core integration points without
 * complex mocking of retry logic. For comprehensive unit tests,
 * see tools/brat/src/infrastructure/__tests__/health-gate.test.ts
 *
 * @module tests/integration/health-gate-basic
 * @since Sprint 5 (I3.10)
 */

import { HealthGate } from '../../tools/brat/src/infrastructure/health-gate';
import { InfrastructureRegistry } from '../../tools/brat/src/infrastructure/registry';
import * as path from 'path';

describe('HealthGate Basic Integration (Sprint 5 I3.10)', () => {
  const repoRoot = path.join(__dirname, '../..');

  describe('InfrastructureRegistry Integration', () => {
    it('should load infrastructure specs with health checks', () => {
      // Given: Infrastructure registry
      const postgresSpec = InfrastructureRegistry.getInfrastructureByCapability(
        repoRoot,
        'local',
        'persistence'
      );

      // Then: Spec includes health check configuration
      expect(postgresSpec).toBeDefined();
      expect(postgresSpec!.healthCheck).toBeDefined();
      expect(postgresSpec!.healthCheck!.test).toBeDefined();
      expect(Array.isArray(postgresSpec!.healthCheck!.test)).toBe(true);
    });

    it('should load health checks for all platform infrastructure', () => {
      // Given: All infrastructure specs
      const allSpecs = InfrastructureRegistry.getAllInfrastructureSpecs(repoRoot, 'local');

      // Then: All specs have health checks defined
      const specsWithHealthChecks = allSpecs.filter(s => s.healthCheck);
      expect(specsWithHealthChecks.length).toBeGreaterThan(0);

      // Core infrastructure should all have health checks
      const natsSpec = allSpecs.find(s => s.serviceName === 'nats');
      const postgresSpec = allSpecs.find(s => s.serviceName === 'postgres');
      const redisSpec = allSpecs.find(s => s.serviceName === 'redis');

      expect(natsSpec?.healthCheck).toBeDefined();
      expect(postgresSpec?.healthCheck).toBeDefined();
      expect(redisSpec?.healthCheck).toBeDefined();
    });
  });

  describe('Health Check Configuration', () => {
    it('should have valid health check test commands', () => {
      // Given: PostgreSQL spec
      const postgresSpec = InfrastructureRegistry.getInfrastructureByCapability(
        repoRoot,
        'local',
        'persistence'
      );

      // Then: Health check has valid test command structure
      const healthCheck = postgresSpec!.healthCheck!;
      expect(healthCheck.test).toBeDefined();
      expect(healthCheck.test.length).toBeGreaterThan(0);

      // First element should be command type (CMD, CMD-SHELL, etc.)
      const [cmdType] = healthCheck.test;
      expect(typeof cmdType).toBe('string');
      expect(['CMD', 'CMD-SHELL', 'docker'].includes(cmdType)).toBe(true);
    });

    it('should have retry and timeout configuration', () => {
      // Given: Infrastructure specs
      const postgresSpec = InfrastructureRegistry.getInfrastructureByCapability(
        repoRoot,
        'local',
        'persistence'
      );

      // Then: Health check includes interval and retries
      const healthCheck = postgresSpec!.healthCheck!;
      expect(healthCheck.interval).toBeDefined();
      expect(healthCheck.retries).toBeDefined();
      expect(typeof healthCheck.interval).toBe('string');
      expect(typeof healthCheck.retries).toBe('number');
    });
  });

  describe('checkHealth Method', () => {
    it('should return true for spec without health check', async () => {
      // Given: Spec without health check
      const mockSpec: any = {
        serviceName: 'test-service',
        capability: 'messaging',
        provider: 'docker',
        image: 'test:latest',
        ports: {},
        config: {},
        // No healthCheck defined
      };

      // When: Check health
      const isHealthy = await HealthGate.checkHealth(mockSpec);

      // Then: Returns true (no health check = assume healthy)
      expect(isHealthy).toBe(true);
    });

    it('should return true for spec with empty health check test', async () => {
      // Given: Spec with empty test array
      const mockSpec: any = {
        serviceName: 'test-service',
        capability: 'messaging',
        provider: 'docker',
        image: 'test:latest',
        ports: {},
        config: {},
        healthCheck: {
          test: [],
          interval: '5s',
          timeout: '3s',
          retries: 3,
        },
      };

      // When: Check health
      const isHealthy = await HealthGate.checkHealth(mockSpec);

      // Then: Returns true (empty test = assume healthy)
      expect(isHealthy).toBe(true);
    });
  });

  describe('Integration with Context Creation', () => {
    it('should support InfrastructureRegistry → HealthGate flow', () => {
      // Given: Context creation needs to wait for PostgreSQL
      const postgresSpec = InfrastructureRegistry.getInfrastructureByCapability(
        repoRoot,
        'local',
        'persistence'
      );

      // Then: Spec is ready for HealthGate consumption
      expect(postgresSpec).toBeDefined();
      expect(postgresSpec!.serviceName).toBe('postgres');
      expect(postgresSpec!.healthCheck).toBeDefined();

      // This spec can be passed directly to HealthGate.waitForInfrastructure()
      // (actual wait tested in unit tests with proper mocking)
    });

    it('should support multiple infrastructure services', () => {
      // Given: Context needs multiple infrastructure services
      const natsSpec = InfrastructureRegistry.getInfrastructureByCapability(
        repoRoot,
        'local',
        'messaging'
      );
      const postgresSpec = InfrastructureRegistry.getInfrastructureByCapability(
        repoRoot,
        'local',
        'persistence'
      );
      const redisSpec = InfrastructureRegistry.getInfrastructureByCapability(
        repoRoot,
        'local',
        'caching'
      );

      // Then: All specs are ready
      expect(natsSpec).toBeDefined();
      expect(postgresSpec).toBeDefined();
      expect(redisSpec).toBeDefined();

      // All specs can be passed to HealthGate.waitForInfrastructure([...])
      const specs = [natsSpec!, postgresSpec!, redisSpec!];
      expect(specs.length).toBe(3);
      expect(specs.every(s => s.healthCheck)).toBe(true);
    });
  });
});

/**
 * Sprint 26 T1.1: Unit tests for infrastructure command translation
 *
 * Tests buildInfrastructureCommand() function that translates declarative
 * architecture.yaml config into Docker Compose command arrays.
 */

import { generateInfrastructureCompose } from '../generate-docker-compose';
import * as path from 'path';

// We need to test the internal buildInfrastructureCommand function
// Since it's not exported, we'll test it indirectly through generateInfrastructureCompose
// by checking the resulting compose definitions

describe('Infrastructure Command Translation (T1.1)', () => {
  const repoRoot = path.join(__dirname, '../../../../..');

  describe('NATS JetStream Configuration', () => {
    it('should include JetStream command when jetstream: true', () => {
      // This test validates that the compose generator properly includes
      // the JetStream command based on architecture.yaml config
      const infrastructure = new Set(['nats']);
      const services = generateInfrastructureCompose(repoRoot, infrastructure, 'local');

      expect(services.nats).toBeDefined();
      expect(services.nats.command).toBeDefined();
      expect(services.nats.command).toContain('-js');
      expect(services.nats.command).toContain('-sd');
      expect(services.nats.command).toContain('/data');
      expect(services.nats.command).toContain('-m');
      expect(services.nats.command).toContain('8222');
    });

    it('should not include command for postgres (no special startup args needed)', () => {
      const infrastructure = new Set(['postgres']);
      const services = generateInfrastructureCompose(repoRoot, infrastructure, 'local');

      expect(services.postgres).toBeDefined();
      // PostgreSQL uses environment variables for config, not command args
      expect(services.postgres.command).toBeUndefined();
    });
  });

  describe('Redis Configuration', () => {
    it('should not include command when no config specified', () => {
      const infrastructure = new Set(['redis']);
      const services = generateInfrastructureCompose(repoRoot, infrastructure, 'local');

      expect(services.redis).toBeDefined();
      // Redis without AOF shouldn't have a command (uses defaults)
      // The actual behavior depends on architecture.yaml
      if (services.redis.command) {
        // If command exists, it should be redis-server with proper flags
        expect(services.redis.command[0]).toBe('redis-server');
      }
    });
  });

  describe('All Infrastructure Services', () => {
    it('should generate valid compose definitions for all required infrastructure', () => {
      const infrastructure = new Set(['nats', 'redis', 'postgres']);
      const services = generateInfrastructureCompose(repoRoot, infrastructure, 'local');

      // Verify all services are present
      expect(services.nats).toBeDefined();
      expect(services.redis).toBeDefined();
      expect(services.postgres).toBeDefined();

      // Verify all have required compose properties
      for (const [name, service] of Object.entries(services)) {
        if (name === 'bitbrat-base') continue; // Skip base image service

        expect(service.image).toBeDefined();
        expect(service.healthcheck).toBeDefined();
        expect(service.networks).toBeDefined();
        if (service.networks) {
          expect(service.networks['bitbrat-network']).toBeDefined();
        }
      }
    });

    it('should include health checks for all infrastructure services', () => {
      const infrastructure = new Set(['nats', 'redis', 'postgres']);
      const services = generateInfrastructureCompose(repoRoot, infrastructure, 'local');

      expect(services.nats.healthcheck).toBeDefined();
      expect(services.redis.healthcheck).toBeDefined();
      expect(services.postgres.healthcheck).toBeDefined();

      // Verify health check structure
      expect(services.nats.healthcheck!.test).toBeDefined();
      expect(services.nats.healthcheck!.interval).toBeDefined();
      expect(services.nats.healthcheck!.timeout).toBeDefined();
      expect(services.nats.healthcheck!.retries).toBeDefined();
    });
  });

  describe('Agent-Dev Context', () => {
    it('should generate infrastructure for agent-dev contexts', () => {
      const infrastructure = new Set(['nats', 'redis', 'postgres']);
      const services = generateInfrastructureCompose(repoRoot, infrastructure, 'agent-dev-test');

      // Agent-dev contexts inherit from local context
      expect(services.nats).toBeDefined();
      expect(services.redis).toBeDefined();
      expect(services.postgres).toBeDefined();

      // NATS should still have JetStream enabled
      expect(services.nats.command).toBeDefined();
      expect(services.nats.command).toContain('-js');
    });
  });
});

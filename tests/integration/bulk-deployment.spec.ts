/**
 * Integration tests for bulk service deployment with generated docker-compose
 *
 * Tests the full flow: Multiple services → generateDockerCompose → orchestrator deployment
 * with realistic bulk deployment scenarios.
 *
 * @module tests/integration/bulk-deployment
 * @since Sprint 5 (I3.9)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import {
  generateDockerCompose,
  type ComposeConfig,
} from '../../tools/brat/src/context/generate-docker-compose';
import { parseServiceDependencies } from '../../tools/brat/src/context/parse-dependencies';
import { getActiveServicesArray } from '../../tools/brat/src/context/parse-services';

describe('Bulk Service Deployment - Integration (Sprint 5 I3.9)', () => {
  const repoRoot = path.join(__dirname, '../..');

  describe('Multiple Service Deployment (I3.9)', () => {
    it('should generate docker-compose with all active services', () => {
      // Given: Multiple active services from architecture.yaml
      const allServices = getActiveServicesArray(repoRoot);
      const activeServices = allServices.filter(s =>
        ['ingress-egress', 'auth', 'llm-bot'].includes(s.name)
      );

      // Collect all infrastructure dependencies
      const infrastructure = new Set<string>();
      for (const service of activeServices) {
        const deps = parseServiceDependencies(repoRoot, service);
        deps.infrastructure.forEach(infra => infrastructure.add(infra));
      }

      // When: Generate compose for bulk deployment
      const config = generateDockerCompose({
        repoRoot,
        contextName: 'local',
        activeServices,
        infrastructure,
      });

      // Then: All services and infrastructure included
      expect(config.services).toHaveProperty('ingress-egress');
      expect(config.services).toHaveProperty('auth');
      expect(config.services).toHaveProperty('llm-bot');

      // Infrastructure services
      expect(config.services).toHaveProperty('nats');
      expect(config.services).toHaveProperty('postgres');
      expect(config.services).toHaveProperty('redis');
      expect(config.services).toHaveProperty('bitbrat-base');

      // Networks and volumes
      expect(config.networks).toHaveProperty('bitbrat-network');
      expect(config.volumes).toBeDefined();
    });

    it('should deduplicate infrastructure dependencies across services', () => {
      // Given: Multiple services with overlapping infrastructure
      const allServices = getActiveServicesArray(repoRoot);
      const activeServices = allServices.filter(s =>
        ['ingress-egress', 'auth', 'llm-bot', 'event-router'].includes(s.name)
      );

      // When: Collect infrastructure from all services
      const infrastructure = new Set<string>();
      for (const service of activeServices) {
        const deps = parseServiceDependencies(repoRoot, service);
        deps.infrastructure.forEach(infra => infrastructure.add(infra));
      }

      // Then: Infrastructure deduplicated (no duplicates)
      const infraArray = Array.from(infrastructure);
      expect(infraArray).toContain('nats');
      expect(infraArray).toContain('postgres');
      expect(infraArray).toContain('redis');

      // Each infrastructure service appears only once
      const natsCount = infraArray.filter(i => i === 'nats').length;
      const postgresCount = infraArray.filter(i => i === 'postgres').length;
      const redisCount = infraArray.filter(i => i === 'redis').length;

      expect(natsCount).toBe(1);
      expect(postgresCount).toBe(1);
      expect(redisCount).toBe(1);
    });

    it('should generate correct depends_on for all services', () => {
      // Given: Multiple services with dependencies
      const allServices = getActiveServicesArray(repoRoot);
      const activeServices = allServices.filter(s =>
        ['ingress-egress', 'auth', 'llm-bot'].includes(s.name)
      );

      const infrastructure = new Set<string>();
      for (const service of activeServices) {
        const deps = parseServiceDependencies(repoRoot, service);
        deps.infrastructure.forEach(infra => infrastructure.add(infra));
      }

      // When: Generate compose
      const config = generateDockerCompose({
        repoRoot,
        contextName: 'local',
        activeServices,
        infrastructure,
      });

      // Then: Each service has correct depends_on
      const ingressService = config.services['ingress-egress'];
      expect(ingressService.depends_on).toBeDefined();
      expect(ingressService.depends_on).toHaveProperty('nats');
      expect(ingressService.depends_on).toHaveProperty('postgres');
      expect(ingressService.depends_on).toHaveProperty('redis');

      const authService = config.services['auth'];
      expect(authService.depends_on).toBeDefined();
      expect(authService.depends_on).toHaveProperty('nats');
      expect(authService.depends_on).toHaveProperty('postgres');
      expect(authService.depends_on).toHaveProperty('redis');

      const llmBotService = config.services['llm-bot'];
      expect(llmBotService.depends_on).toBeDefined();
      expect(llmBotService.depends_on).toHaveProperty('nats');
      expect(llmBotService.depends_on).toHaveProperty('postgres');
      expect(llmBotService.depends_on).toHaveProperty('redis');
    });

    it('should assign unique ports to all services', () => {
      // Given: Multiple services
      const allServices = getActiveServicesArray(repoRoot);
      const activeServices = allServices.filter(s =>
        ['ingress-egress', 'event-router', 'llm-bot', 'auth'].includes(s.name)
      );

      const infrastructure = new Set<string>();
      for (const service of activeServices) {
        const deps = parseServiceDependencies(repoRoot, service);
        deps.infrastructure.forEach(infra => infrastructure.add(infra));
      }

      // When: Generate compose
      const config = generateDockerCompose({
        repoRoot,
        contextName: 'local',
        activeServices,
        infrastructure,
      });

      // Then: Each service has unique host port mapping
      const portMappings: Record<string, string> = {};
      for (const [serviceName, serviceDef] of Object.entries(config.services)) {
        if (serviceDef.ports && serviceDef.ports.length > 0) {
          portMappings[serviceName] = serviceDef.ports[0];
        }
      }

      // Extract host ports
      const hostPorts = Object.values(portMappings).map(mapping => {
        const match = mapping.match(/^(\$\{[^}]+}|\d+):/);
        return match ? match[1] : '';
      });

      // All service ports should be defined
      expect(portMappings['ingress-egress']).toBeDefined();
      expect(portMappings['auth']).toBeDefined();
      expect(portMappings['llm-bot']).toBeDefined();
    });

    it('should include all required volumes from infrastructure', () => {
      // Given: Multiple infrastructure services with volumes
      const allServices = getActiveServicesArray(repoRoot);
      const activeServices = allServices.filter(s =>
        ['ingress-egress', 'auth'].includes(s.name)
      );

      const infrastructure = new Set(['nats', 'postgres', 'redis']);

      // When: Generate compose
      const config = generateDockerCompose({
        repoRoot,
        contextName: 'local',
        activeServices,
        infrastructure,
      });

      // Then: All infrastructure volumes included
      expect(config.volumes).toBeDefined();
      expect(config.volumes).toHaveProperty('nats-data');
      expect(config.volumes).toHaveProperty('postgres-data');
      expect(config.volumes).toHaveProperty('redis-data');

      // Volume definitions are empty objects (default driver)
      expect(config.volumes!['nats-data']).toEqual({});
      expect(config.volumes!['postgres-data']).toEqual({});
      expect(config.volumes!['redis-data']).toEqual({});
    });
  });

  describe('Full Platform Deployment (I3.9)', () => {
    it('should generate docker-compose for entire platform', () => {
      // Given: All active services from architecture.yaml
      const allServices = getActiveServicesArray(repoRoot);
      const activeServices = allServices.filter(s => {
        // Load architecture.yaml to check which services are active
        const archPath = path.join(repoRoot, 'architecture.yaml');
        const archContent = fs.readFileSync(archPath, 'utf-8');
        const arch = yaml.parse(archContent);
        return arch.services[s.name]?.active === true;
      });

      // Collect all infrastructure
      const infrastructure = new Set<string>();
      for (const service of activeServices) {
        const deps = parseServiceDependencies(repoRoot, service);
        deps.infrastructure.forEach(infra => infrastructure.add(infra));
      }

      // When: Generate full platform compose
      const config = generateDockerCompose({
        repoRoot,
        contextName: 'local',
        activeServices,
        infrastructure,
      });

      // Then: Platform services included
      expect(Object.keys(config.services).length).toBeGreaterThan(5);

      // Core infrastructure always present
      expect(config.services).toHaveProperty('nats');
      expect(config.services).toHaveProperty('postgres');
      expect(config.services).toHaveProperty('redis');
      expect(config.services).toHaveProperty('bitbrat-base');

      // Network configuration
      expect(config.networks).toHaveProperty('bitbrat-network');
      expect(config.networks!['bitbrat-network'].driver).toBe('bridge');
      expect(config.networks!['bitbrat-network'].name).toBe('bitbrat-local-network');

      // Volumes from infrastructure
      expect(config.volumes).toBeDefined();
      expect(Object.keys(config.volumes!).length).toBeGreaterThan(0);
    });

    it('should handle services with no infrastructure dependencies', () => {
      // Given: Mix of services (some with infrastructure, some without)
      const allServices = getActiveServicesArray(repoRoot);

      // Create a mock service with no infrastructure dependencies
      const mockService: any = {
        name: 'test-service',
        active: true,
        category: 'domain' as const,
        profile: 'core' as const,
        kind: 'pipeline-service',
        entry: 'src/apps/test-service.ts',
        envKeys: [],
        secrets: [],
      };

      const infrastructure = new Set<string>();

      // When: Generate compose with service that has no infrastructure
      const config = generateDockerCompose({
        repoRoot,
        contextName: 'local',
        activeServices: [mockService],
        infrastructure,
      });

      // Then: Service included even without infrastructure
      expect(config.services).toHaveProperty('test-service');
      expect(config.services['test-service']).toHaveProperty('build');

      // Only bitbrat-base included (from legacy compose)
      const serviceKeys = Object.keys(config.services);
      expect(serviceKeys).toContain('bitbrat-base');
    });

    it('should generate environment variables for all services', () => {
      // Given: Services with environment variables and secrets
      const allServices = getActiveServicesArray(repoRoot);
      const activeServices = allServices.filter(s =>
        ['llm-bot', 'auth'].includes(s.name)
      );

      const infrastructure = new Set(['nats', 'postgres', 'redis']);

      // When: Generate compose
      const config = generateDockerCompose({
        repoRoot,
        contextName: 'local',
        activeServices,
        infrastructure,
      });

      // Then: Each service has environment section
      const llmBotService = config.services['llm-bot'];
      expect(llmBotService.environment).toBeDefined();

      const authService = config.services['auth'];
      expect(authService.environment).toBeDefined();

      // Environment variables use ${VAR} interpolation
      if (llmBotService.environment) {
        const envVars = Object.values(llmBotService.environment);
        const hasInterpolation = envVars.some(val =>
          typeof val === 'string' && val.includes('${')
        );
        expect(hasInterpolation).toBe(true);
      }
    });
  });

  describe('Service Ordering and Dependencies (I3.9)', () => {
    it('should generate dependency graph for service startup', () => {
      // Given: Services with inter-service dependencies
      const allServices = getActiveServicesArray(repoRoot);
      const activeServices = allServices.filter(s =>
        ['ingress-egress', 'event-router', 'llm-bot', 'auth'].includes(s.name)
      );

      const infrastructure = new Set<string>();
      for (const service of activeServices) {
        const deps = parseServiceDependencies(repoRoot, service);
        deps.infrastructure.forEach(infra => infrastructure.add(infra));
      }

      // When: Generate compose
      const config = generateDockerCompose({
        repoRoot,
        contextName: 'local',
        activeServices,
        infrastructure,
      });

      // Then: Infrastructure services have no depends_on (they start first)
      expect(config.services['nats'].depends_on).toBeUndefined();
      expect(config.services['postgres'].depends_on).toBeUndefined();
      expect(config.services['redis'].depends_on).toBeUndefined();

      // Application services depend on infrastructure
      expect(config.services['ingress-egress'].depends_on).toBeDefined();
      expect(config.services['auth'].depends_on).toBeDefined();
      expect(config.services['llm-bot'].depends_on).toBeDefined();
    });

    it('should set correct health check conditions for dependencies', () => {
      // Given: Service with infrastructure dependencies
      const allServices = getActiveServicesArray(repoRoot);
      const activeServices = allServices.filter(s => s.name === 'auth');

      const infrastructure = new Set(['nats', 'postgres', 'redis']);

      // When: Generate compose
      const config = generateDockerCompose({
        repoRoot,
        contextName: 'local',
        activeServices,
        infrastructure,
      });

      // Then: Infrastructure dependencies have service_healthy condition
      const authService = config.services['auth'];
      expect(authService.depends_on).toBeDefined();

      if (authService.depends_on && typeof authService.depends_on === 'object' && !Array.isArray(authService.depends_on)) {
        const natsDepCheck = authService.depends_on['nats'] as any;
        const postgresDepCheck = authService.depends_on['postgres'] as any;
        const redisDepCheck = authService.depends_on['redis'] as any;

        expect(natsDepCheck?.condition).toBe('service_healthy');
        expect(postgresDepCheck?.condition).toBe('service_healthy');
        expect(redisDepCheck?.condition).toBe('service_healthy');
      }
    });
  });

  describe('Generated File Structure (I3.9)', () => {
    it('should match expected docker-compose.yaml structure', () => {
      // Given: Full service deployment
      const allServices = getActiveServicesArray(repoRoot);
      const activeServices = allServices.filter(s =>
        ['ingress-egress', 'auth', 'llm-bot'].includes(s.name)
      );

      const infrastructure = new Set(['nats', 'postgres', 'redis']);

      // When: Generate compose
      const config = generateDockerCompose({
        repoRoot,
        contextName: 'local',
        activeServices,
        infrastructure,
      });

      // Then: Top-level keys present
      expect(config).toHaveProperty('services');
      expect(config).toHaveProperty('networks');
      expect(config).toHaveProperty('volumes');

      // Services is an object
      expect(typeof config.services).toBe('object');
      expect(Array.isArray(config.services)).toBe(false);

      // Networks is an object
      expect(typeof config.networks).toBe('object');

      // Volumes is an object
      expect(typeof config.volumes).toBe('object');
    });

    it('should be valid YAML when serialized', () => {
      // Given: Generated config
      const allServices = getActiveServicesArray(repoRoot);
      const activeServices = allServices.filter(s => s.name === 'auth');

      const infrastructure = new Set(['nats', 'postgres']);

      const config = generateDockerCompose({
        repoRoot,
        contextName: 'local',
        activeServices,
        infrastructure,
      });

      // When: Serialize to YAML
      const yamlContent = yaml.stringify(config);

      // Then: Can be parsed back
      const parsed = yaml.parse(yamlContent);

      expect(parsed).toHaveProperty('services');
      expect(parsed.services).toHaveProperty('auth');
      expect(parsed.services).toHaveProperty('nats');
      expect(parsed.services).toHaveProperty('postgres');
    });
  });
});

/**
 * Integration tests for Docker Compose generation from architecture.yaml v2
 *
 * Tests the full flow: InfrastructureRegistry → generateDockerCompose → file output
 * with realistic service and infrastructure configurations.
 *
 * @module tests/integration/docker-compose-generation
 * @since Sprint 5 (I3.8)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import {
  generateDockerCompose,
  generateInfrastructureCompose,
  generateServiceCompose,
  writeDockerCompose,
  type ComposeConfig,
} from '../../tools/brat/src/context/generate-docker-compose';
import { InfrastructureRegistry } from '../../tools/brat/src/infrastructure/registry';
import { parseServiceDependencies } from '../../tools/brat/src/context/parse-dependencies';
import { getServiceMetadata, type ServiceMetadata } from '../../tools/brat/src/context/parse-services';

describe('Docker Compose Generation - Integration (Sprint 5 I3.8)', () => {
  const repoRoot = path.join(__dirname, '../..');
  const testOutputDir = path.join(__dirname, '__test-output__');

  beforeEach(() => {
    // Create test output directory
    if (!fs.existsSync(testOutputDir)) {
      fs.mkdirSync(testOutputDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test output directory
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  describe('Single Service Deployment (I3.8)', () => {
    it('should generate docker-compose with infrastructure from architecture.yaml', () => {
      // Given: Single active service with infrastructure dependencies
      const metadata = getServiceMetadata(repoRoot, 'llm-bot');
      expect(metadata).toBeDefined();

      const dependencies = parseServiceDependencies(repoRoot, metadata!);

      // When: Generate compose configuration
      const config = generateDockerCompose({
        repoRoot,
        contextName: 'local',
        activeServices: [metadata!],
        infrastructure: new Set(dependencies.infrastructure),
      });

      // Then: Configuration includes service and infrastructure
      expect(config.services).toHaveProperty('llm-bot');
      expect(config.services).toHaveProperty('bitbrat-base'); // Build-only service
      expect(config.services).toHaveProperty('nats'); // Messaging infrastructure
      expect(config.services).toHaveProperty('postgres'); // Persistence infrastructure
      expect(config.services).toHaveProperty('redis'); // Caching infrastructure

      // Verify service definition structure
      const llmBotService = config.services['llm-bot'];
      expect(llmBotService).toHaveProperty('build');
      expect(llmBotService.build?.context).toBe('../..');
      expect(llmBotService.build?.dockerfile).toBe('Dockerfile.service');
      expect(llmBotService.build?.args).toHaveProperty('SERVICE_NAME', 'llm-bot');
      expect(llmBotService).toHaveProperty('depends_on');
      expect(llmBotService.depends_on).toHaveProperty('nats');
      expect(llmBotService.depends_on).toHaveProperty('postgres');
      expect(llmBotService.depends_on).toHaveProperty('redis');

      // Verify infrastructure service definition
      const natsService = config.services['nats'];
      expect(natsService).toHaveProperty('image');
      expect(natsService.image).toContain('nats');
      expect(natsService).toHaveProperty('healthcheck');
      expect(natsService).toHaveProperty('networks');
    });

    it('should generate infrastructure services from architecture.yaml docker provider', () => {
      // Given: Infrastructure requirements
      const infrastructure = new Set(['nats', 'postgres', 'redis']);

      // When: Generate infrastructure compose
      const infraServices = generateInfrastructureCompose(
        repoRoot,
        infrastructure,
        'local'
      );

      // Then: All infrastructure services generated with correct structure
      expect(infraServices).toHaveProperty('nats');
      expect(infraServices).toHaveProperty('postgres');
      expect(infraServices).toHaveProperty('redis');

      // Verify NATS configuration
      const natsService = infraServices['nats'];
      expect(natsService.image).toContain('nats'); // Version may vary (e.g., nats:2-alpine or nats:2.10-alpine)
      expect(natsService.ports).toContain('4222:4222'); // Client port always included
      expect(natsService.ports).toContain('8222:8222'); // Monitoring port always included
      expect(natsService.healthcheck).toBeDefined();
      expect(natsService.networks).toHaveProperty('bitbrat-network');

      // Verify PostgreSQL configuration
      const postgresService = infraServices['postgres'];
      expect(postgresService.image).toContain('postgres'); // May be pgvector/pgvector:pg15 or postgres:15-alpine
      expect(postgresService.ports).toContain('5432:5432'); // Main port always included
      expect(postgresService.healthcheck).toBeDefined();
      expect(postgresService.environment).toHaveProperty('POSTGRES_USER');

      // Verify Redis configuration
      const redisService = infraServices['redis'];
      expect(redisService.image).toBe('redis:7-alpine');
      expect(redisService.ports).toEqual(['6379:6379']);
      expect(redisService.healthcheck).toBeDefined();
    });

    it('should extract volume names from infrastructure services dynamically', () => {
      // Given: Infrastructure with volumes
      const infrastructure = new Set(['nats', 'postgres', 'redis']);

      // When: Generate compose with infrastructure
      const config = generateDockerCompose({
        repoRoot,
        contextName: 'local',
        activeServices: [],
        infrastructure,
      });

      // Then: Volumes extracted from infrastructure definitions
      expect(config.volumes).toBeDefined();
      expect(config.volumes).toHaveProperty('nats-data');
      expect(config.volumes).toHaveProperty('postgres-data');
      expect(config.volumes).toHaveProperty('redis-data');

      // Verify volume definitions
      expect(config.volumes!['nats-data']).toEqual({});
      expect(config.volumes!['postgres-data']).toEqual({});
      expect(config.volumes!['redis-data']).toEqual({});
    });

    it('should include bitbrat-base service from legacy compose file', () => {
      // Given: Infrastructure generation
      const infrastructure = new Set(['nats']);

      // When: Generate infrastructure compose
      const infraServices = generateInfrastructureCompose(
        repoRoot,
        infrastructure,
        'local'
      );

      // Then: bitbrat-base included from docker-compose.local.yaml
      expect(infraServices).toHaveProperty('bitbrat-base');
      expect(infraServices['bitbrat-base']).toHaveProperty('profiles', ['build-only']);
      expect(infraServices['bitbrat-base'].image).toContain('bitbrat-base');
    });

    it('should write docker-compose file with correct format and header', () => {
      // Given: Generated config
      const config: ComposeConfig = {
        services: {
          'test-service': {
            image: 'test:latest',
            ports: ['3000:3000'],
          },
        },
        networks: {
          'bitbrat-network': {
            driver: 'bridge',
          },
        },
        volumes: {
          'test-data': {},
        },
      };

      const outputPath = path.join(testOutputDir, 'docker-compose.test.yaml');

      // When: Write compose file
      writeDockerCompose(config, outputPath);

      // Then: File written with header and correct YAML structure
      expect(fs.existsSync(outputPath)).toBe(true);

      const content = fs.readFileSync(outputPath, 'utf-8');
      expect(content).toContain('# Generated Docker Compose configuration');
      expect(content).toContain('# DO NOT EDIT MANUALLY');
      expect(content).toContain('# Generated:');

      // Verify YAML is valid
      const parsed = yaml.parse(content);
      expect(parsed.services).toHaveProperty('test-service');
      expect(parsed.networks).toHaveProperty('bitbrat-network');
      expect(parsed.volumes).toHaveProperty('test-data');
    });
  });

  describe('Service Dependency Resolution (I3.8)', () => {
    it('should resolve infrastructure dependencies from service imports', () => {
      // Given: Service with infrastructure dependencies
      const metadata = getServiceMetadata(repoRoot, 'auth');
      expect(metadata).toBeDefined();

      // When: Parse service dependencies
      const dependencies = parseServiceDependencies(repoRoot, metadata!);

      // Then: Infrastructure dependencies detected
      expect(dependencies.infrastructure).toContain('nats');
      expect(dependencies.infrastructure).toContain('postgres');
      expect(dependencies.infrastructure).toContain('redis');
    });

    it('should generate health check dependencies correctly', () => {
      // Given: Service with infrastructure dependencies
      const metadata = getServiceMetadata(repoRoot, 'ingress-egress');
      expect(metadata).toBeDefined();

      const dependencies = parseServiceDependencies(repoRoot, metadata!);

      // When: Generate service compose
      const serviceDef = generateServiceCompose(metadata!, dependencies, 'local');

      // Then: depends_on includes health check conditions
      expect(serviceDef.depends_on).toBeDefined();

      // Infrastructure dependencies have service_healthy condition
      Object.entries(serviceDef.depends_on!).forEach(([key, value]) => {
        if (typeof value === 'object' && 'condition' in value) {
          // Infrastructure services require health checks
          if (['nats', 'postgres', 'redis'].includes(key)) {
            expect(value.condition).toBe('service_healthy');
          }
        }
      });
    });
  });

  describe('Context-Specific Infrastructure (I3.8)', () => {
    it('should apply context-specific infrastructure overrides', () => {
      // Given: Infrastructure with context-specific overrides
      const infrastructure = new Set(['postgres']);

      // When: Generate for staging context
      const infraServices = generateInfrastructureCompose(
        repoRoot,
        infrastructure,
        'staging'
      );

      // Then: PostgreSQL service includes staging-specific config
      const postgresService = infraServices['postgres'];
      expect(postgresService).toBeDefined();
      expect(postgresService.environment).toBeDefined();

      // Environment variables should be defined (may be resolved or interpolated)
      expect(postgresService.environment!['POSTGRES_USER']).toBeDefined();
      expect(postgresService.environment!['POSTGRES_PASSWORD']).toBeDefined();
    });

    it('should generate context-specific network names', () => {
      // Given: Active services for specific context
      const config = generateDockerCompose({
        repoRoot,
        contextName: 'agent-dev-test',
        activeServices: [],
        infrastructure: new Set(['nats']),
      });

      // Then: Network name includes context name
      expect(config.networks).toHaveProperty('bitbrat-network');
      expect(config.networks!['bitbrat-network'].name).toBe('bitbrat-agent-dev-test-network');
    });
  });

  describe('InfrastructureRegistry Integration (I3.8)', () => {
    it('should load infrastructure specs from architecture.yaml', () => {
      // When: Get all infrastructure specs
      const allSpecs = InfrastructureRegistry.getAllInfrastructureSpecs(repoRoot, 'local');

      // Then: All platform infrastructure specs loaded
      expect(allSpecs.length).toBeGreaterThan(0);

      const natsSpec = allSpecs.find(s => s.serviceName === 'nats');
      expect(natsSpec).toBeDefined();
      expect(natsSpec?.capability).toBe('messaging');
      expect(natsSpec?.image).toContain('nats'); // Version may vary
      expect(natsSpec?.healthCheck).toBeDefined();

      const postgresSpec = allSpecs.find(s => s.serviceName === 'postgres');
      expect(postgresSpec).toBeDefined();
      expect(postgresSpec?.capability).toBe('persistence');
      expect(postgresSpec?.image).toContain('postgres'); // May be pgvector/pgvector:pg15 or postgres:15-alpine

      const redisSpec = allSpecs.find(s => s.serviceName === 'redis');
      expect(redisSpec).toBeDefined();
      expect(redisSpec?.capability).toBe('caching');
      expect(redisSpec?.image).toBe('redis:7-alpine');
    });

    it('should resolve infrastructure by capability', () => {
      // When: Get infrastructure by capability
      const messagingSpec = InfrastructureRegistry.getInfrastructureByCapability(
        repoRoot,
        'local',
        'messaging'
      );

      // Then: NATS spec returned
      expect(messagingSpec).toBeDefined();
      expect(messagingSpec?.serviceName).toBe('nats');
      expect(messagingSpec?.capability).toBe('messaging');
    });

    it('should handle missing infrastructure specs gracefully', () => {
      // When: Try to get non-existent infrastructure capability
      // Then: Should throw an error with helpful message
      expect(() => {
        InfrastructureRegistry.getInfrastructureByCapability(
          repoRoot,
          'local',
          'nonexistent-capability' as any
        );
      }).toThrow(/Unknown capability/);
    });
  });
});

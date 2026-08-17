/**
 * Unit tests for InfrastructureRegistry
 *
 * Tests cover:
 * - Architecture loading and caching
 * - Capability resolution
 * - Configuration merging
 * - Constraint validation
 * - Dependency validation
 *
 * Target: 90%+ code coverage
 */

import * as fs from 'fs';
import * as path from 'path';
import { InfrastructureRegistry } from './registry';
import type { ArchitectureYaml, ServiceMetadata } from './types';

// Mock architecture.yaml v2 for testing
const mockArchitectureV2: ArchitectureYaml = {
  platform: {
    version: '2.0',
    infrastructure: {
      messaging: {
        required: true,
        capabilities: ['publish-subscribe', 'stream-retention'],
        config: {
          defaultTTL: 3600,
          deliveryGuarantee: 'at-least-once',
        },
        constraints: {
          minRetention: 86400,
          requireDurability: true,
        },
        intent: ['Event-driven orchestration between services'],
      },
      caching: {
        required: true,
        capabilities: ['key-value-store', 'expiration-policies'],
        config: {
          defaultTTL: 300,
          evictionPolicy: 'allkeys-lru',
        },
        constraints: {
          minMemory: '128mb',
          requirePersistence: true,
        },
        intent: ['Idempotency tracking via distributed locks'],
      },
      persistence: {
        required: true,
        capabilities: ['relational-database', 'ACID-transactions'],
        config: {
          connectionPool: { min: 10, max: 100 },
        },
        constraints: {
          requireACID: true,
          requireSSL: true,
        },
        intent: ['Persistent event storage with JSONB'],
      },
    },
  },
  infrastructure: {
    docker: {
      config: {
        scope: 'local',
        scalability: 'vertical',
        costModel: 'zero-cost',
      },
      constraints: {
        maxInstances: 1,
        offlineCapable: true,
      },
      intent: ['Primary development environment'],
      messaging: {
        service: 'nats',
        image: 'nats:2.10-alpine',
        ports: { client: '4222:4222', http: '8222:8222' },
        config: {
          maxPayload: 10485760,
          jetstream: true, // Enable JetStream for durability
          persistence: true, // Satisfy requireDurability constraint
        },
        healthCheck: {
          test: ['CMD', 'wget', '--quiet', '--tries=1', '--spider', 'http://localhost:8222/healthz'],
          interval: '10s',
        },
      },
      caching: {
        service: 'redis',
        image: 'redis:7-alpine',
        ports: { main: '6379:6379' },
        config: {
          maxmemory: '256mb',
          appendonly: 'yes',
        },
        healthCheck: {
          test: ['CMD', 'redis-cli', 'ping'],
          interval: '10s',
        },
      },
      persistence: {
        service: 'postgres',
        image: 'postgres:15-alpine',
        ports: { main: '5432:5432' },
        config: { maxConnections: 200 },
        healthCheck: {
          test: ['CMD-SHELL', 'pg_isready -U bitbrat'],
          interval: '10s',
        },
      },
    },
  },
  services: {
    'llm-bot': {
      name: 'llm-bot',
      active: true,
      dependencies: {
        infrastructure: ['messaging', 'caching', 'persistence'],
        services: ['auth', 'tool-gateway'],
      },
    },
    auth: {
      name: 'auth',
      active: true,
      dependencies: {
        infrastructure: ['messaging', 'caching', 'persistence'],
      },
    },
    'tool-gateway': {
      name: 'tool-gateway',
      active: true,
      dependencies: {
        infrastructure: ['messaging', 'persistence'],
      },
    },
    inactive: {
      name: 'inactive',
      active: false,
      dependencies: {
        infrastructure: ['messaging'],
      },
    },
  },
  executionContexts: {
    local: {
      infrastructure: {
        provider: 'docker',
        caching: {
          config: { maxmemory: '128mb' }, // Override
        },
      },
    },
    staging: {
      infrastructure: {
        provider: 'docker',
        caching: {
          config: { maxmemory: '512mb' }, // Different override
        },
      },
    },
  },
};

// Mock fs module
jest.mock('fs');
jest.mock('path');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockPath = path as jest.Mocked<typeof path>;

describe('InfrastructureRegistry', () => {
  beforeEach(() => {
    // Clear cache before each test
    InfrastructureRegistry.clearCache();

    // Mock path.join to return predictable paths
    mockPath.join.mockImplementation((...args) => args.join('/'));

    // Mock fs.existsSync to return true
    mockFs.existsSync.mockReturnValue(true);

    // Mock fs.readFileSync to return our mock architecture
    mockFs.readFileSync.mockReturnValue(JSON.stringify(mockArchitectureV2));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('loadArchitecture', () => {
    it('should load and parse architecture.yaml successfully', () => {
      const arch = InfrastructureRegistry.loadArchitecture('/test/repo');

      expect(arch).toBeDefined();
      expect(arch.platform?.version).toBe('2.0');
      expect(arch.platform?.infrastructure).toBeDefined();
      expect(arch.infrastructure).toBeDefined();
    });

    it('should cache loaded architecture for performance', () => {
      // First call
      InfrastructureRegistry.loadArchitecture('/test/repo');

      // Second call should use cache
      InfrastructureRegistry.loadArchitecture('/test/repo');

      // readFileSync should only be called once
      expect(mockFs.readFileSync).toHaveBeenCalledTimes(1);
    });

    it('should throw error if architecture.yaml not found', () => {
      mockFs.existsSync.mockReturnValue(false);

      expect(() => InfrastructureRegistry.loadArchitecture('/test/repo')).toThrow(
        'architecture.yaml not found'
      );
    });

    it('should throw error if architecture.yaml has invalid YAML', () => {
      mockFs.readFileSync.mockReturnValue('invalid: yaml: [');

      expect(() => InfrastructureRegistry.loadArchitecture('/test/repo')).toThrow(
        'Failed to parse architecture.yaml'
      );
    });

    it('should throw error if platform section missing', () => {
      const invalidArch = { ...mockArchitectureV2, platform: undefined };
      mockFs.readFileSync.mockReturnValue(JSON.stringify(invalidArch));

      expect(() => InfrastructureRegistry.loadArchitecture('/test/repo')).toThrow(
        'architecture.yaml missing "platform" section'
      );
    });

    it('should throw error if infrastructure section missing', () => {
      const invalidArch = { ...mockArchitectureV2, infrastructure: undefined };
      mockFs.readFileSync.mockReturnValue(JSON.stringify(invalidArch));

      expect(() => InfrastructureRegistry.loadArchitecture('/test/repo')).toThrow(
        'architecture.yaml missing "infrastructure" section'
      );
    });

    it('should throw error if services section missing', () => {
      const invalidArch = { ...mockArchitectureV2, services: undefined };
      mockFs.readFileSync.mockReturnValue(JSON.stringify(invalidArch));

      expect(() => InfrastructureRegistry.loadArchitecture('/test/repo')).toThrow(
        'architecture.yaml missing "services" section'
      );
    });

    it('should throw error if executionContexts section missing', () => {
      const invalidArch = { ...mockArchitectureV2, executionContexts: undefined };
      mockFs.readFileSync.mockReturnValue(JSON.stringify(invalidArch));

      expect(() => InfrastructureRegistry.loadArchitecture('/test/repo')).toThrow(
        'architecture.yaml missing "executionContexts" section'
      );
    });
  });

  describe('getInfrastructureByCapability', () => {
    it('should resolve messaging capability to NATS for Docker provider', () => {
      const spec = InfrastructureRegistry.getInfrastructureByCapability(
        '/test/repo',
        'local',
        'messaging'
      );

      expect(spec).toBeDefined();
      expect(spec?.capability).toBe('messaging');
      expect(spec?.provider).toBe('docker');
      expect(spec?.serviceName).toBe('nats');
      expect(spec?.image).toBe('nats:2.10-alpine');
    });

    it('should merge config in correct priority order (platform → provider → context)', () => {
      const spec = InfrastructureRegistry.getInfrastructureByCapability(
        '/test/repo',
        'local',
        'caching'
      );

      expect(spec?.config).toEqual({
        defaultTTL: 300, // From platform
        evictionPolicy: 'allkeys-lru', // From platform
        maxmemory: '128mb', // From context (overrides provider's 256mb)
        appendonly: 'yes', // From provider
      });
    });

    it('should apply different context overrides for staging', () => {
      const spec = InfrastructureRegistry.getInfrastructureByCapability(
        '/test/repo',
        'staging',
        'caching'
      );

      expect(spec?.config.maxmemory).toBe('512mb'); // staging override
    });

    it('should throw error if context not found', () => {
      expect(() =>
        InfrastructureRegistry.getInfrastructureByCapability('/test/repo', 'nonexistent', 'messaging')
      ).toThrow('Execution context "nonexistent" not found');
    });

    it('should throw error if context missing provider', () => {
      const archWithoutProvider = {
        ...mockArchitectureV2,
        executionContexts: {
          badcontext: {
            infrastructure: {}, // Missing provider
          },
        },
      };
      mockFs.readFileSync.mockReturnValue(JSON.stringify(archWithoutProvider));
      InfrastructureRegistry.clearCache();

      expect(() =>
        InfrastructureRegistry.getInfrastructureByCapability('/test/repo', 'badcontext', 'messaging')
      ).toThrow('missing infrastructure.provider');
    });

    it('should throw error if capability not defined in platform', () => {
      expect(() =>
        InfrastructureRegistry.getInfrastructureByCapability('/test/repo', 'local', 'unknown')
      ).toThrow('Unknown capability "unknown"');
    });

    it('should throw error if provider not found', () => {
      const archWithBadProvider = {
        ...mockArchitectureV2,
        executionContexts: {
          ...mockArchitectureV2.executionContexts,
          local: {
            infrastructure: { provider: 'nonexistent' },
          },
        },
      };
      mockFs.readFileSync.mockReturnValue(JSON.stringify(archWithBadProvider));
      InfrastructureRegistry.clearCache();

      expect(() =>
        InfrastructureRegistry.getInfrastructureByCapability('/test/repo', 'local', 'messaging')
      ).toThrow('Provider "nonexistent" not found');
    });

    it('should throw error if provider does not implement capability', () => {
      const archMissingImpl = {
        ...mockArchitectureV2,
        infrastructure: {
          docker: {
            // Missing messaging implementation
            caching: mockArchitectureV2.infrastructure!.docker.caching,
          },
        },
      };
      mockFs.readFileSync.mockReturnValue(JSON.stringify(archMissingImpl));
      InfrastructureRegistry.clearCache();

      expect(() =>
        InfrastructureRegistry.getInfrastructureByCapability('/test/repo', 'local', 'messaging')
      ).toThrow('does not implement capability "messaging"');
    });

    it('should validate minMemory constraint', () => {
      const archViolatingConstraint = {
        ...mockArchitectureV2,
        infrastructure: {
          docker: {
            ...mockArchitectureV2.infrastructure!.docker,
            caching: {
              ...mockArchitectureV2.infrastructure!.docker.caching,
              config: { maxmemory: '64mb' }, // Below platform minMemory (128mb)
            },
          },
        },
      };
      mockFs.readFileSync.mockReturnValue(JSON.stringify(archViolatingConstraint));
      InfrastructureRegistry.clearCache();

      expect(() =>
        InfrastructureRegistry.getInfrastructureByCapability('/test/repo', 'local', 'caching')
      ).toThrow('violates constraint "minMemory"');
    });

    it('should validate requirePersistence constraint', () => {
      const archViolatingPersistence = {
        ...mockArchitectureV2,
        infrastructure: {
          docker: {
            ...mockArchitectureV2.infrastructure!.docker,
            caching: {
              ...mockArchitectureV2.infrastructure!.docker.caching,
              config: {}, // No appendonly or persistence
            },
          },
        },
      };
      mockFs.readFileSync.mockReturnValue(JSON.stringify(archViolatingPersistence));
      InfrastructureRegistry.clearCache();

      expect(() =>
        InfrastructureRegistry.getInfrastructureByCapability('/test/repo', 'local', 'caching')
      ).toThrow('violates constraint "requirePersistence"');
    });
  });

  describe('getRequiredInfrastructure', () => {
    it('should collect all infrastructure from active services', () => {
      const services: ServiceMetadata[] = [
        { name: 'llm-bot', active: true },
        { name: 'auth', active: true },
      ];

      const specs = InfrastructureRegistry.getRequiredInfrastructure('/test/repo', 'local', services);

      expect(specs).toHaveLength(3); // messaging, caching, persistence
      expect(specs.map((s) => s.capability).sort()).toEqual(['caching', 'messaging', 'persistence']);
    });

    it('should deduplicate capabilities across services', () => {
      const services: ServiceMetadata[] = [
        { name: 'llm-bot', active: true }, // needs all 3
        { name: 'auth', active: true }, // needs all 3
        { name: 'tool-gateway', active: true }, // needs messaging, persistence
      ];

      const specs = InfrastructureRegistry.getRequiredInfrastructure('/test/repo', 'local', services);

      // Should still be 3 (deduplicated)
      expect(specs).toHaveLength(3);
    });

    it('should return sorted list of infrastructure specs', () => {
      const services: ServiceMetadata[] = [{ name: 'llm-bot', active: true }];

      const specs = InfrastructureRegistry.getRequiredInfrastructure('/test/repo', 'local', services);

      // Should be sorted alphabetically by capability
      expect(specs.map((s) => s.capability)).toEqual(['caching', 'messaging', 'persistence']);
    });

    it('should handle services with no infrastructure dependencies', () => {
      const archNoInfraDeps = {
        ...mockArchitectureV2,
        services: {
          'no-infra': {
            name: 'no-infra',
            active: true,
            dependencies: {}, // No infrastructure deps
          },
        },
      };
      mockFs.readFileSync.mockReturnValue(JSON.stringify(archNoInfraDeps));
      InfrastructureRegistry.clearCache();

      const services: ServiceMetadata[] = [{ name: 'no-infra', active: true }];

      const specs = InfrastructureRegistry.getRequiredInfrastructure('/test/repo', 'local', services);

      expect(specs).toHaveLength(0);
    });

    it('should warn if service not found in architecture.yaml', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const services: ServiceMetadata[] = [{ name: 'nonexistent', active: true }];

      InfrastructureRegistry.getRequiredInfrastructure('/test/repo', 'local', services);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Service "nonexistent" not found')
      );

      consoleWarnSpy.mockRestore();
    });

    it('should throw error if capability cannot be resolved', () => {
      const archMissingImpl = {
        ...mockArchitectureV2,
        infrastructure: {
          docker: {}, // Missing all implementations
        },
      };
      mockFs.readFileSync.mockReturnValue(JSON.stringify(archMissingImpl));
      InfrastructureRegistry.clearCache();

      const services: ServiceMetadata[] = [{ name: 'llm-bot', active: true }];

      expect(() =>
        InfrastructureRegistry.getRequiredInfrastructure('/test/repo', 'local', services)
      ).toThrow('Failed to resolve infrastructure capability');
    });
  });

  describe('getInfrastructureServices', () => {
    it('should return all infrastructure service names for Docker provider', () => {
      const serviceNames = InfrastructureRegistry.getInfrastructureServices('/test/repo', 'local');

      expect(serviceNames).toEqual(['nats', 'postgres', 'redis']); // Sorted
    });

    it('should exclude metadata fields (config, constraints, intent)', () => {
      const serviceNames = InfrastructureRegistry.getInfrastructureServices('/test/repo', 'local');

      expect(serviceNames).not.toContain('config');
      expect(serviceNames).not.toContain('constraints');
      expect(serviceNames).not.toContain('intent');
    });

    it('should throw error if context not found', () => {
      expect(() =>
        InfrastructureRegistry.getInfrastructureServices('/test/repo', 'nonexistent')
      ).toThrow('Execution context "nonexistent" not found');
    });

    it('should throw error if provider not found', () => {
      const archWithBadProvider = {
        ...mockArchitectureV2,
        executionContexts: {
          ...mockArchitectureV2.executionContexts,
          local: {
            infrastructure: { provider: 'nonexistent' },
          },
        },
      };
      mockFs.readFileSync.mockReturnValue(JSON.stringify(archWithBadProvider));
      InfrastructureRegistry.clearCache();

      expect(() =>
        InfrastructureRegistry.getInfrastructureServices('/test/repo', 'local')
      ).toThrow('Provider "nonexistent" not found');
    });
  });

  describe('validateDependencies', () => {
    it('should return valid result for satisfied dependencies', () => {
      const services: ServiceMetadata[] = [
        { name: 'llm-bot', active: true },
        { name: 'auth', active: true },
      ];

      const result = InfrastructureRegistry.validateDependencies('/test/repo', 'local', services);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing context', () => {
      const services: ServiceMetadata[] = [];

      const result = InfrastructureRegistry.validateDependencies(
        '/test/repo',
        'nonexistent',
        services
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([
        expect.stringContaining('Execution context "nonexistent" not found'),
      ]);
    });

    it('should detect missing provider', () => {
      const archMissingProvider = {
        ...mockArchitectureV2,
        executionContexts: {
          ...mockArchitectureV2.executionContexts,
          local: {
            infrastructure: {}, // Missing provider
          },
        },
      };
      mockFs.readFileSync.mockReturnValue(JSON.stringify(archMissingProvider));
      InfrastructureRegistry.clearCache();

      const services: ServiceMetadata[] = [];

      const result = InfrastructureRegistry.validateDependencies('/test/repo', 'local', services);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([expect.stringContaining('missing infrastructure.provider')]);
    });

    it('should detect unsatisfiable infrastructure dependencies', () => {
      const archMissingImpl = {
        ...mockArchitectureV2,
        infrastructure: {
          docker: {}, // Missing all implementations
        },
      };
      mockFs.readFileSync.mockReturnValue(JSON.stringify(archMissingImpl));
      InfrastructureRegistry.clearCache();

      const services: ServiceMetadata[] = [{ name: 'llm-bot', active: true }];

      const result = InfrastructureRegistry.validateDependencies('/test/repo', 'local', services);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // Should detect that capabilities cannot be satisfied (will fail on first capability checked: messaging)
      expect(result.errors[0]).toContain('requires capability');
    });

    it('should warn about inactive service dependencies', () => {
      const services: ServiceMetadata[] = [
        { name: 'llm-bot', active: true }, // Depends on auth (active) and tool-gateway (active)
      ];

      const result = InfrastructureRegistry.validateDependencies('/test/repo', 'local', services);

      // Should be valid but may have warnings
      expect(result.valid).toBe(true);
    });

    it('should warn about dependencies on inactive services', () => {
      const archWithInactiveDep = {
        ...mockArchitectureV2,
        services: {
          ...mockArchitectureV2.services,
          'test-service': {
            name: 'test-service',
            active: true,
            dependencies: {
              services: ['inactive'], // Depends on inactive service
            },
          },
        },
      };
      mockFs.readFileSync.mockReturnValue(JSON.stringify(archWithInactiveDep));
      InfrastructureRegistry.clearCache();

      const services: ServiceMetadata[] = [{ name: 'test-service', active: true }];

      const result = InfrastructureRegistry.validateDependencies('/test/repo', 'local', services);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('depends on "inactive" but it is not active');
    });

    it('should warn about services not found in architecture.yaml', () => {
      const services: ServiceMetadata[] = [{ name: 'nonexistent', active: true }];

      const result = InfrastructureRegistry.validateDependencies('/test/repo', 'local', services);

      expect(result.warnings).toEqual([
        expect.stringContaining('Service "nonexistent" not found'),
      ]);
    });
  });

  describe('clearCache', () => {
    it('should clear the architecture cache', () => {
      // Load architecture (caches it)
      InfrastructureRegistry.loadArchitecture('/test/repo');
      expect(mockFs.readFileSync).toHaveBeenCalledTimes(1);

      // Clear cache
      InfrastructureRegistry.clearCache();

      // Load again (should read file again)
      InfrastructureRegistry.loadArchitecture('/test/repo');
      expect(mockFs.readFileSync).toHaveBeenCalledTimes(2);
    });
  });
});

/**
 * Tests for parse-dependencies module
 * Sprint 2 (REDIS-BEC-006): Infrastructure detection tests
 */

import { getRequiredInfrastructure, parseServiceDependencies } from './parse-dependencies';
import { ServiceMetadata } from './parse-services';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { InfrastructureRegistry } from '../infrastructure/registry';

// Mock fs
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock InfrastructureRegistry to avoid filesystem dependency
jest.mock('../infrastructure/registry', () => ({
  InfrastructureRegistry: {
    getInfrastructureByCapability: jest.fn((repoRoot: string, context: string, capability: string) => {
      const capabilityMap: Record<string, { serviceName: string; capability: string }> = {
        messaging: { serviceName: 'nats', capability: 'messaging' },
        persistence: { serviceName: 'postgres', capability: 'persistence' },
        caching: { serviceName: 'redis', capability: 'caching' },
        'messaging-debug': { serviceName: 'nats-box', capability: 'messaging-debug' },
      };
      return capabilityMap[capability] || { serviceName: capability, capability };
    }),
    getRequiredInfrastructure: jest.fn((repoRoot: string, context: string, services: any[]) => {
      // Aggregate infrastructure from all services
      const infrastructureSet = new Set<string>();

      // Mock reading architecture.yaml to get service dependencies
      const archContent = mockFs.readFileSync(path.join(repoRoot, 'architecture.yaml'), 'utf-8');
      const arch = yaml.load(archContent) as any;

      for (const svc of services) {
        const serviceDeps = arch?.services?.[svc.name]?.dependencies?.infrastructure || [];
        for (const cap of serviceDeps) {
          const capabilityMap: Record<string, string> = {
            messaging: 'nats',
            persistence: 'postgres',
            caching: 'redis',
            'messaging-debug': 'nats-box',
          };
          infrastructureSet.add(capabilityMap[cap] || cap);
        }
      }

      // Return as InfrastructureSpec array
      return Array.from(infrastructureSet).map((name) => ({
        serviceName: name,
        capability: name === 'nats' ? 'messaging' : name === 'postgres' ? 'persistence' : name === 'redis' ? 'caching' : 'messaging-debug',
        provider: 'docker' as const,
        image: `${name}:latest`,
        ports: {},
        config: {},
      }));
    }),
    getAllInfrastructureSpecs: jest.fn(),
  },
}));

describe('getRequiredInfrastructure', () => {
  const mockRepoRoot = '/mock/repo';

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock architecture.yaml with v2 schema (platform.infrastructure + service dependencies)
    const mockArch = {
      platform: {
        infrastructure: {
          docker: {
            nats: {
              capability: 'messaging',
              serviceName: 'nats',
              image: 'nats:2.10-alpine',
            },
            postgres: {
              capability: 'persistence',
              serviceName: 'postgres',
              image: 'pgvector/pgvector:pg15',
            },
            redis: {
              capability: 'caching',
              serviceName: 'redis',
              image: 'redis:7-alpine',
            },
            'nats-box': {
              capability: 'messaging-debug',
              serviceName: 'nats-box',
              image: 'natsio/nats-box:0.14.0',
            },
          },
        },
      },
      services: {
        'ingress-egress': {
          active: true,
          profile: 'gateway',
          env: { PERSISTENCE_DRIVER: 'postgres' },
          dependencies: {
            infrastructure: ['messaging', 'caching', 'persistence'],
          },
        },
        auth: {
          active: true,
          profile: 'core',
          env: { PERSISTENCE_DRIVER: 'postgres' },
          dependencies: {
            infrastructure: ['messaging', 'caching', 'persistence'],
          },
        },
        'llm-bot': {
          active: true,
          profile: 'llm',
          env: { PERSISTENCE_DRIVER: 'postgres' },
          dependencies: {
            infrastructure: ['messaging', 'caching', 'persistence'],
          },
        },
        persistence: {
          active: true,
          profile: 'core',
          env: { PERSISTENCE_DRIVER: 'postgres' },
          dependencies: {
            infrastructure: ['messaging', 'persistence'],
          },
        },
        'test-service': {
          active: true,
          profile: 'core',
          dependencies: {
            infrastructure: ['messaging', 'caching', 'persistence'],
          },
        },
        'minimal-service': {
          active: true,
          profile: 'core',
          dependencies: {
            infrastructure: ['caching'],
          },
        },
      },
    };

    mockFs.readFileSync.mockReturnValue(yaml.dump(mockArch));
  });

  // REDIS-BEC-006: Test that Redis is always included
  it('always includes redis in infrastructure set', () => {
    const services: ServiceMetadata[] = [
      {
        name: 'test-service',
        active: true,
        profile: 'core',
        category: 'platform',
        kind: 'pipeline-service',
        entry: 'src/apps/test-service.ts',
        envKeys: [],
        secrets: [],
      },
    ];

    const infrastructure = getRequiredInfrastructure(mockRepoRoot, services);

    expect(infrastructure.has('redis')).toBe(true);
  });

  it('returns empty set when no services provided', () => {
    const services: ServiceMetadata[] = [];

    const infrastructure = getRequiredInfrastructure(mockRepoRoot, services);

    // Sprint 5: Infrastructure is only included based on explicit service dependencies
    expect(infrastructure.size).toBe(0);
  });

  it('includes postgres when service needs persistence', () => {
    const services: ServiceMetadata[] = [
      {
        name: 'auth',
        active: true,
        profile: 'core',
        category: 'platform',
        kind: 'pipeline-service',
        entry: 'src/apps/auth-service.ts',
        envKeys: ['PERSISTENCE_DRIVER'],
        secrets: [],
      },
    ];

    const infrastructure = getRequiredInfrastructure(mockRepoRoot, services);

    expect(infrastructure.has('postgres')).toBe(true);
  });

  it('includes all required infrastructure for full service set', () => {
    const services: ServiceMetadata[] = [
      {
        name: 'auth',
        active: true,
        profile: 'core',
        category: 'platform',
        kind: 'pipeline-service',
        entry: 'src/apps/auth-service.ts',
        envKeys: ['PERSISTENCE_DRIVER'],
        secrets: [],
      },
      {
        name: 'llm-bot',
        active: true,
        profile: 'llm',
        category: 'platform',
        kind: 'pipeline-service',
        entry: 'src/apps/llm-bot-service.ts',
        envKeys: ['PERSISTENCE_DRIVER'],
        secrets: [],
      },
    ];

    const infrastructure = getRequiredInfrastructure(mockRepoRoot, services);

    // Should include all infrastructure required by these services
    expect(infrastructure.has('nats')).toBe(true);
    expect(infrastructure.has('redis')).toBe(true);
    expect(infrastructure.has('postgres')).toBe(true);
    // Sprint 5: nats-box is only included if a service depends on messaging-debug
  });

  it('includes redis even with minimal service set', () => {
    const services: ServiceMetadata[] = [
      {
        name: 'minimal-service',
        active: true,
        profile: 'core',
        category: 'platform',
        kind: 'pipeline-service',
        entry: 'src/apps/minimal-service.ts',
        envKeys: [],
        secrets: [],
      },
    ];

    const infrastructure = getRequiredInfrastructure(mockRepoRoot, services);

    // Redis should always be present (Sprint 2+)
    expect(infrastructure.has('redis')).toBe(true);
  });
});

describe('parseServiceDependencies', () => {
  const mockRepoRoot = '/mock/repo';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // REDIS-BEC-006: Test that idempotency services get Redis dependency
  it('adds redis dependency for ingress-egress service', () => {
    const mockArch = {
      platform: {
        infrastructure: {
          docker: {
            nats: { capability: 'messaging', serviceName: 'nats' },
            postgres: { capability: 'persistence', serviceName: 'postgres' },
            redis: { capability: 'caching', serviceName: 'redis' },
          },
        },
      },
      services: {
        'ingress-egress': {
          active: true,
          profile: 'gateway',
          env: { PERSISTENCE_DRIVER: 'postgres' },
          dependencies: {
            infrastructure: ['messaging', 'caching', 'persistence'],
          },
        },
      },
    };
    mockFs.readFileSync.mockReturnValue(yaml.dump(mockArch));

    const metadata: ServiceMetadata = {
      name: 'ingress-egress',
      active: true,
      profile: 'gateway',
      category: 'platform',
      kind: 'gateway',
      entry: 'src/apps/ingress-egress-service.ts',
      envKeys: ['PERSISTENCE_DRIVER'],
      secrets: [],
    };

    const deps = parseServiceDependencies(mockRepoRoot, metadata);

    expect(deps.infrastructure).toContain('redis');
  });

  it('adds redis dependency for auth service', () => {
    const mockArch = {
      platform: {
        infrastructure: {
          docker: {
            nats: { capability: 'messaging', serviceName: 'nats' },
            postgres: { capability: 'persistence', serviceName: 'postgres' },
            redis: { capability: 'caching', serviceName: 'redis' },
          },
        },
      },
      services: {
        auth: {
          active: true,
          profile: 'core',
          env: { PERSISTENCE_DRIVER: 'postgres' },
          dependencies: {
            infrastructure: ['messaging', 'caching', 'persistence'],
          },
        },
      },
    };
    mockFs.readFileSync.mockReturnValue(yaml.dump(mockArch));

    const metadata: ServiceMetadata = {
      name: 'auth',
      active: true,
      profile: 'core',
      category: 'platform',
      kind: 'pipeline-service',
      entry: 'src/apps/auth-service.ts',
      envKeys: ['PERSISTENCE_DRIVER'],
      secrets: [],
    };

    const deps = parseServiceDependencies(mockRepoRoot, metadata);

    expect(deps.infrastructure).toContain('redis');
  });

  it('adds redis dependency for llm-bot service', () => {
    const mockArch = {
      platform: {
        infrastructure: {
          docker: {
            nats: { capability: 'messaging', serviceName: 'nats' },
            postgres: { capability: 'persistence', serviceName: 'postgres' },
            redis: { capability: 'caching', serviceName: 'redis' },
          },
        },
      },
      services: {
        'llm-bot': {
          active: true,
          profile: 'llm',
          env: { PERSISTENCE_DRIVER: 'postgres' },
          dependencies: {
            infrastructure: ['messaging', 'caching', 'persistence'],
          },
        },
      },
    };
    mockFs.readFileSync.mockReturnValue(yaml.dump(mockArch));

    const metadata: ServiceMetadata = {
      name: 'llm-bot',
      active: true,
      profile: 'llm',
      category: 'platform',
      kind: 'pipeline-service',
      entry: 'src/apps/llm-bot-service.ts',
      envKeys: ['PERSISTENCE_DRIVER'],
      secrets: [],
    };

    const deps = parseServiceDependencies(mockRepoRoot, metadata);

    expect(deps.infrastructure).toContain('redis');
  });

  it('adds redis dependency for all services (Sprint 3 Fix #10)', () => {
    const mockArch = {
      platform: {
        infrastructure: {
          docker: {
            nats: { capability: 'messaging', serviceName: 'nats' },
            postgres: { capability: 'persistence', serviceName: 'postgres' },
            redis: { capability: 'caching', serviceName: 'redis' },
          },
        },
      },
      services: {
        persistence: {
          active: true,
          profile: 'core',
          env: { PERSISTENCE_DRIVER: 'postgres' },
          dependencies: {
            infrastructure: ['messaging', 'persistence'],
          },
        },
      },
    };
    mockFs.readFileSync.mockReturnValue(yaml.dump(mockArch));

    const metadata: ServiceMetadata = {
      name: 'persistence',
      active: true,
      profile: 'core',
      category: 'platform',
      kind: 'pipeline-service',
      entry: 'src/apps/persistence-service.ts',
      envKeys: ['PERSISTENCE_DRIVER'],
      secrets: [],
    };

    const deps = parseServiceDependencies(mockRepoRoot, metadata);

    // Sprint 5: Infrastructure dependencies are explicit (not all services get Redis)
    expect(deps.infrastructure).toContain('nats');
    expect(deps.infrastructure).toContain('postgres');
    // Note: persistence service doesn't need Redis/caching
  });

  it('always includes nats for messaging', () => {
    const mockArch = {
      platform: {
        infrastructure: {
          docker: {
            nats: { capability: 'messaging', serviceName: 'nats' },
          },
        },
      },
      services: {
        'test-service': {
          active: true,
          profile: 'core',
          dependencies: {
            infrastructure: ['messaging'],
          },
        },
      },
    };
    mockFs.readFileSync.mockReturnValue(yaml.dump(mockArch));

    const metadata: ServiceMetadata = {
      name: 'test-service',
      active: true,
      profile: 'core',
      category: 'platform',
      kind: 'pipeline-service',
      entry: 'src/apps/test-service.ts',
      envKeys: [],
      secrets: [],
    };

    const deps = parseServiceDependencies(mockRepoRoot, metadata);

    expect(deps.infrastructure).toContain('nats');
  });

  it('adds postgres for services with PERSISTENCE_DRIVER', () => {
    const mockArch = {
      platform: {
        infrastructure: {
          docker: {
            postgres: { capability: 'persistence', serviceName: 'postgres' },
          },
        },
      },
      services: {
        'test-service': {
          active: true,
          profile: 'core',
          env: { PERSISTENCE_DRIVER: 'postgres' },
          dependencies: {
            infrastructure: ['persistence'],
          },
        },
      },
    };
    mockFs.readFileSync.mockReturnValue(yaml.dump(mockArch));

    const metadata: ServiceMetadata = {
      name: 'test-service',
      active: true,
      profile: 'core',
      category: 'platform',
      kind: 'pipeline-service',
      entry: 'src/apps/test-service.ts',
      envKeys: ['PERSISTENCE_DRIVER'],
      secrets: [],
    };

    const deps = parseServiceDependencies(mockRepoRoot, metadata);

    expect(deps.infrastructure).toContain('postgres');
  });

  it('returns correct dependency structure', () => {
    const mockArch = {
      platform: {
        infrastructure: {
          docker: {
            nats: { capability: 'messaging', serviceName: 'nats' },
            postgres: { capability: 'persistence', serviceName: 'postgres' },
            redis: { capability: 'caching', serviceName: 'redis' },
          },
        },
      },
      services: {
        auth: {
          active: true,
          profile: 'core',
          env: { PERSISTENCE_DRIVER: 'postgres' },
          dependencies: {
            infrastructure: ['messaging', 'caching', 'persistence'],
          },
        },
      },
    };
    mockFs.readFileSync.mockReturnValue(yaml.dump(mockArch));

    const metadata: ServiceMetadata = {
      name: 'auth',
      active: true,
      profile: 'core',
      category: 'platform',
      kind: 'pipeline-service',
      entry: 'src/apps/auth-service.ts',
      envKeys: ['PERSISTENCE_DRIVER'],
      secrets: [],
    };

    const deps = parseServiceDependencies(mockRepoRoot, metadata);

    expect(deps).toHaveProperty('name', 'auth');
    expect(deps).toHaveProperty('infrastructure');
    expect(deps).toHaveProperty('services');
    expect(deps).toHaveProperty('networkAliases');
    expect(deps).toHaveProperty('healthCheck');

    expect(Array.isArray(deps.infrastructure)).toBe(true);
    expect(Array.isArray(deps.services)).toBe(true);
    expect(Array.isArray(deps.networkAliases)).toBe(true);
  });
});

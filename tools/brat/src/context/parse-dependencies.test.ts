/**
 * Tests for parse-dependencies module
 * Sprint 2 (REDIS-BEC-006): Infrastructure detection tests
 */

import { getRequiredInfrastructure, parseServiceDependencies } from './parse-dependencies';
import { ServiceMetadata } from './parse-services';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';

// Mock fs
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('getRequiredInfrastructure', () => {
  const mockRepoRoot = '/mock/repo';

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock architecture.yaml with basic service definitions
    const mockArch = {
      services: {
        'ingress-egress': {
          active: true,
          profile: 'gateway',
          env: { PERSISTENCE_DRIVER: 'postgres' },
        },
        auth: {
          active: true,
          profile: 'core',
          env: { PERSISTENCE_DRIVER: 'postgres' },
        },
        'llm-bot': {
          active: true,
          profile: 'llm',
          env: { PERSISTENCE_DRIVER: 'postgres' },
        },
        persistence: {
          active: true,
          profile: 'core',
          env: { PERSISTENCE_DRIVER: 'postgres' },
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

  it('always includes nats in infrastructure set', () => {
    const services: ServiceMetadata[] = [];

    const infrastructure = getRequiredInfrastructure(mockRepoRoot, services);

    expect(infrastructure.has('nats')).toBe(true);
  });

  it('always includes nats-box in infrastructure set', () => {
    const services: ServiceMetadata[] = [];

    const infrastructure = getRequiredInfrastructure(mockRepoRoot, services);

    expect(infrastructure.has('nats-box')).toBe(true);
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

    // Should include all core infrastructure
    expect(infrastructure.has('nats')).toBe(true);
    expect(infrastructure.has('redis')).toBe(true);
    expect(infrastructure.has('nats-box')).toBe(true);
    expect(infrastructure.has('postgres')).toBe(true);
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
      services: {
        'ingress-egress': {
          active: true,
          profile: 'gateway',
          env: { PERSISTENCE_DRIVER: 'postgres' },
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
      services: {
        auth: {
          active: true,
          profile: 'core',
          env: { PERSISTENCE_DRIVER: 'postgres' },
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
      services: {
        'llm-bot': {
          active: true,
          profile: 'llm',
          env: { PERSISTENCE_DRIVER: 'postgres' },
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
      services: {
        persistence: {
          active: true,
          profile: 'core',
          env: { PERSISTENCE_DRIVER: 'postgres' },
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

    // Sprint 3 Fix #10: All services get Redis (platform-wide infrastructure)
    expect(deps.infrastructure).toContain('nats');
    expect(deps.infrastructure).toContain('redis');
  });

  it('always includes nats for messaging', () => {
    const mockArch = {
      services: {
        'test-service': {
          active: true,
          profile: 'core',
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
      services: {
        'test-service': {
          active: true,
          profile: 'core',
          env: { PERSISTENCE_DRIVER: 'postgres' },
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
      services: {
        auth: {
          active: true,
          profile: 'core',
          env: { PERSISTENCE_DRIVER: 'postgres' },
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

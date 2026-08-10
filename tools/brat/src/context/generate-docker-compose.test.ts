/**
 * Tests for generate-docker-compose module
 * Sprint 2 (REDIS-BEC-007): Docker Compose generation tests
 */

import {
  generateDockerCompose,
  generateInfrastructureCompose,
} from './generate-docker-compose';
import { ServiceMetadata } from './parse-services';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { InfrastructureRegistry } from '../infrastructure/registry';
import type { InfrastructureSpec } from '../infrastructure/types';

// Mock fs
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock InfrastructureRegistry
jest.mock('../infrastructure/registry', () => {
  // Import type here for use in mock
  type InfrastructureSpec = import('../infrastructure/types').InfrastructureSpec;

  const createMockSpecs = (): InfrastructureSpec[] => [
    {
      serviceName: 'nats',
      capability: 'messaging',
      provider: 'docker',
      image: 'nats:2.9-alpine',
      ports: { client: '4222', monitoring: '8222' },
      config: {},
      volumes: [{ name: 'nats-data', mount: '/data' }],
      healthCheck: {
        test: ['CMD', 'nats', 'server', 'check'],
        interval: '5s',
        timeout: '3s',
        retries: 10,
      },
    },
    {
      serviceName: 'redis',
      capability: 'caching',
      provider: 'docker',
      image: 'redis:7-alpine',
      ports: { main: '6379' },
      config: {},
      volumes: [{ name: 'redis-data', mount: '/data' }],
      healthCheck: {
        test: ['CMD', 'redis-cli', 'ping'],
        interval: '5s',
        timeout: '3s',
        retries: 10,
      },
    },
    {
      serviceName: 'postgres',
      capability: 'persistence',
      provider: 'docker',
      image: 'postgres:15-alpine',
      ports: { main: '5432' },
      config: {},
      volumes: [{ name: 'postgres-data', mount: '/var/lib/postgresql/data' }],
      healthCheck: {
        test: ['CMD', 'pg_isready'],
        interval: '5s',
        timeout: '3s',
        retries: 10,
      },
    },
    {
      serviceName: 'nats-box',
      capability: 'messaging-debug',
      provider: 'docker',
      image: 'natsio/nats-box:latest',
      ports: {},
      config: {},
      volumes: [],
    },
  ];

  return {
    InfrastructureRegistry: {
      getAllInfrastructureSpecs: jest.fn(() => createMockSpecs()),
      getInfrastructureSpec: jest.fn((repoRoot: string, context: string, serviceName: string) => {
        const specs = createMockSpecs();
        return specs.find(s => s.serviceName === serviceName);
      }),
      getInfrastructureByCapability: jest.fn(),
      getRequiredInfrastructure: jest.fn(),
    },
  };
});

describe('generateDockerCompose', () => {
  const mockRepoRoot = '/mock/repo';

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock infrastructure compose file (docker-compose.local.yaml)
    const mockInfraCompose = {
      services: {
        nats: {
          image: 'nats:2.9-alpine',
          healthcheck: { test: ['CMD', 'nats', 'server', 'check'] },
        },
        redis: {
          image: 'redis:7-alpine',
          healthcheck: { test: ['CMD', 'redis-cli', 'ping'] },
        },
        postgres: {
          image: 'postgres:15-alpine',
          healthcheck: { test: ['CMD', 'pg_isready'] },
        },
        'nats-box': {
          image: 'natsio/nats-box:latest',
        },
      },
    };

    mockFs.readFileSync.mockReturnValue(yaml.dump(mockInfraCompose));
  });

  // REDIS-BEC-007: Test Redis service inclusion
  it('includes redis service when redis in infrastructure', () => {
    const infrastructure = new Set(['nats', 'redis', 'nats-box']);
    const activeServices: ServiceMetadata[] = [];

    const config = generateDockerCompose({
      repoRoot: mockRepoRoot,
      contextName: 'test',
      activeServices,
      infrastructure,
    });

    expect(config.services.redis).toBeDefined();
    expect(config.services.redis.image).toBe('redis:7-alpine');
  });

  // REDIS-BEC-007: Test redis-data volume creation
  it('includes redis-data volume when redis in infrastructure', () => {
    const infrastructure = new Set(['nats', 'redis']);
    const activeServices: ServiceMetadata[] = [];

    const config = generateDockerCompose({
      repoRoot: mockRepoRoot,
      contextName: 'test',
      activeServices,
      infrastructure,
    });

    expect(config.volumes).toHaveProperty('redis-data');
    expect(config.volumes!['redis-data']).toEqual({});
  });

  it('includes nats-data volume when nats in infrastructure', () => {
    const infrastructure = new Set(['nats']);
    const activeServices: ServiceMetadata[] = [];

    const config = generateDockerCompose({
      repoRoot: mockRepoRoot,
      contextName: 'test',
      activeServices,
      infrastructure,
    });

    expect(config.volumes).toHaveProperty('nats-data');
  });

  it('includes postgres-data volume when postgres in infrastructure', () => {
    const infrastructure = new Set(['postgres']);
    const activeServices: ServiceMetadata[] = [];

    const config = generateDockerCompose({
      repoRoot: mockRepoRoot,
      contextName: 'test',
      activeServices,
      infrastructure,
    });

    expect(config.volumes).toHaveProperty('postgres-data');
  });

  it('includes all volumes for full infrastructure set', () => {
    const infrastructure = new Set(['nats', 'redis', 'postgres', 'nats-box']);
    const activeServices: ServiceMetadata[] = [];

    const config = generateDockerCompose({
      repoRoot: mockRepoRoot,
      contextName: 'test',
      activeServices,
      infrastructure,
    });

    expect(config.volumes).toHaveProperty('nats-data');
    expect(config.volumes).toHaveProperty('redis-data');
    expect(config.volumes).toHaveProperty('postgres-data');
  });

  it('creates context-specific network name', () => {
    const infrastructure = new Set(['nats']);
    const activeServices: ServiceMetadata[] = [];

    const config = generateDockerCompose({
      repoRoot: mockRepoRoot,
      contextName: 'staging',
      activeServices,
      infrastructure,
    });

    expect(config.networks!['bitbrat-network'].name).toBe('bitbrat-staging-network');
  });

  it('includes all infrastructure services', () => {
    const infrastructure = new Set(['nats', 'redis', 'postgres', 'nats-box']);
    const activeServices: ServiceMetadata[] = [];

    const config = generateDockerCompose({
      repoRoot: mockRepoRoot,
      contextName: 'test',
      activeServices,
      infrastructure,
    });

    expect(config.services.nats).toBeDefined();
    expect(config.services.redis).toBeDefined();
    expect(config.services.postgres).toBeDefined();
    expect(config.services['nats-box']).toBeDefined();
  });

  it('does not include redis-data volume when redis not in infrastructure', () => {
    const infrastructure = new Set(['nats', 'postgres']);
    const activeServices: ServiceMetadata[] = [];

    const config = generateDockerCompose({
      repoRoot: mockRepoRoot,
      contextName: 'test',
      activeServices,
      infrastructure,
    });

    expect(config.volumes).not.toHaveProperty('redis-data');
    expect(config.volumes).toHaveProperty('nats-data');
    expect(config.volumes).toHaveProperty('postgres-data');
  });
});

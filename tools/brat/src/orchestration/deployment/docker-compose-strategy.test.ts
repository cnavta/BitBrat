/**
 * Unit tests for Docker Compose deployment strategy
 *
 * @module orchestration/deployment/docker-compose-strategy.test
 * @since Sprint 372
 */

import { DockerComposeStrategy } from './docker-compose-strategy';
import type { ServiceWithName } from './strategy';
import type { ResolvedContext } from '../../context/types';

// Mock fs module with promises for Sprint 375 ComposeMerger integration
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
  },
}));

import * as fs from 'fs';
const mockFs = fs as jest.Mocked<typeof fs>;
const mockReadFile = (mockFs.promises.readFile as jest.MockedFunction<any>);
const mockWriteFile = (mockFs.promises.writeFile as jest.MockedFunction<any>);

// Mock InfrastructureRegistry (Sprint 5)
jest.mock('../../infrastructure/registry', () => {
  type InfrastructureSpec = import('../../infrastructure/types').InfrastructureSpec;

  const createMockSpecs = (): InfrastructureSpec[] => [
    {
      serviceName: 'nats',
      capability: 'messaging',
      provider: 'docker',
      image: 'nats:2.10-alpine',
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
  ];

  return {
    InfrastructureRegistry: {
      getAllInfrastructureSpecs: jest.fn(() => createMockSpecs()),
      getInfrastructureSpec: jest.fn((repoRoot: string, context: string, serviceName: string) => {
        const specs = createMockSpecs();
        return specs.find(s => s.serviceName === serviceName);
      }),
      getInfrastructureByCapability: jest.fn((repoRoot: string, context: string, capability: string) => {
        const specs = createMockSpecs();
        const capabilityMap: Record<string, string> = {
          messaging: 'nats',
          caching: 'redis',
          persistence: 'postgres',
        };
        const serviceName = capabilityMap[capability];
        return specs.find(s => s.serviceName === serviceName);
      }),
      getRequiredInfrastructure: jest.fn(),
      getInfrastructureServices: jest.fn((repoRoot: string, context: string) => {
        const specs = createMockSpecs();
        return specs.map(s => s.serviceName).sort();
      }),
    },
  };
});

// Mock DockerOrchestrator
jest.mock('../docker/orchestrator', () => ({
  DockerOrchestrator: jest.fn().mockImplementation(() => ({
    up: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('DockerComposeStrategy', () => {
  let strategy: DockerComposeStrategy;
  let mockService: ServiceWithName;
  let mockContext: ResolvedContext;

  beforeEach(() => {
    strategy = new DockerComposeStrategy();
    jest.clearAllMocks();

    // Sprint 5: Mock architecture.yaml reading for InfrastructureRegistry
    const mockArchYaml = `
platform:
  infrastructure:
    docker:
      nats:
        capability: messaging
        serviceName: nats
        image: nats:2.10-alpine
        ports:
          client: "4222"
          monitoring: "8222"
      postgres:
        capability: persistence
        serviceName: postgres
        image: postgres:15-alpine
        ports:
          main: "5432"
      redis:
        capability: caching
        serviceName: redis
        image: redis:7-alpine
        ports:
          main: "6379"
services:
  test-service:
    active: true
    dependencies:
      infrastructure:
        - messaging
        - persistence
  service-a:
    active: true
    dependencies:
      infrastructure:
        - messaging
  service-b:
    active: true
    dependencies:
      infrastructure:
        - messaging
  service-c:
    active: true
    dependencies:
      infrastructure:
        - messaging
`;

    // Mock fs.readFileSync for architecture.yaml and docker-compose files
    (mockFs.readFileSync as jest.MockedFunction<any>).mockImplementation((filepath: string) => {
      if (filepath.includes('architecture.yaml')) {
        return mockArchYaml;
      }
      if (filepath.includes('docker-compose.local.yaml')) {
        return `
services:
  bitbrat-base:
    image: bitbrat-base:latest
    profiles:
      - build-only
`;
      }
      return '';
    });

    // Sprint 375: Mock fs.promises for ComposeMerger integration
    // Simulate reading base compose file and writing merged file
    mockReadFile.mockResolvedValue(`
services:
  test-service:
    image: test:latest
    environment:
      NODE_ENV: production
`);
    mockWriteFile.mockResolvedValue(undefined);

    mockService = {
      name: 'test-service',
      active: true,
      entry: 'dist/apps/test-service.js',
      port: 3000,
    };

    mockContext = {
      name: 'local',
      deployment: {
        type: 'docker-compose',
        docker: {
          host: 'unix:///var/run/docker.sock',
        },
      },
      runtime: {
        gateway: {
          url: 'http://localhost:3000',
        },
        persistence: {
          driver: 'postgres',
          connection: {
            host: 'localhost',
            port: 5432,
            database: 'bitbrat',
            username: 'bitbrat',
            password: 'test',
          },
        },
        envVars: {
          NODE_ENV: 'development',
          LOG_LEVEL: 'debug',
        },
      },
    } as any;
  });

  describe('name', () => {
    it('should return docker-compose', () => {
      expect(strategy.name).toBe('docker-compose');
    });
  });

  describe('prepare()', () => {
    it('should create deployment plan with local docker host', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const plan = await strategy.prepare(mockService, mockContext, {});

      expect(plan.service.name).toBe('test-service');
      expect(plan.context.name).toBe('local');
      expect(plan.envVars.NODE_ENV).toBe('development');
      expect(plan.envVars.LOG_LEVEL).toBe('debug');
      expect(plan.metadata.remoteHost).toBeUndefined();
      expect(plan.metadata.dockerfilePath).toBeDefined();
      expect(plan.metadata.composeFilePath).toBeDefined();
    });

    it('should create deployment plan with remote docker host', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const remoteContext: ResolvedContext = {
        ...mockContext,
        deployment: {
          type: 'docker-compose',
          docker: {
            host: 'ssh://root@bitbrat.lan',
            remoteDir: '/opt/BitBratPlatform',
          },
        },
      } as any;

      const plan = await strategy.prepare(mockService, remoteContext, {});

      expect(plan.metadata.remoteHost).toBe('ssh://root@bitbrat.lan');
      expect(plan.metadata.remoteDir).toBe('/opt/BitBratPlatform');
    });

    it('should throw error if docker configuration missing', async () => {
      const invalidContext: ResolvedContext = {
        ...mockContext,
        deployment: {
          type: 'docker-compose',
          // docker config missing
        },
      } as any;

      await expect(strategy.prepare(mockService, invalidContext, {})).rejects.toThrow(
        /Docker configuration missing/
      );
    });

    it('should load env vars from context', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const contextWithEnv: ResolvedContext = {
        ...mockContext,
        runtime: {
          ...mockContext.runtime,
          envVars: {
            DATABASE_URL: 'postgres://localhost/test',
            API_KEY: 'test-key',
          },
        },
      };

      const plan = await strategy.prepare(mockService, contextWithEnv, {});

      expect(plan.envVars.DATABASE_URL).toBe('postgres://localhost/test');
      expect(plan.envVars.API_KEY).toBe('test-key');
    });
  });

  describe('validate()', () => {
    it('should pass validation when all files exist', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const plan = await strategy.prepare(mockService, mockContext, {});
      const result = await strategy.validate(plan);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation when dockerfile missing', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const plan = await strategy.prepare(mockService, mockContext, {});
      const result = await strategy.validate(plan);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Dockerfile not found');
    });

    it('should warn when compose file missing', async () => {
      // Dockerfile exists, compose file doesn't
      mockFs.existsSync.mockImplementation((path: any) => {
        return path.toString().includes('Dockerfile');
      });

      const plan = await strategy.prepare(mockService, mockContext, {});
      const result = await strategy.validate(plan);

      expect(result.valid).toBe(true); // Still valid, just a warning
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Compose file not found');
    });

    it('should fail validation for invalid SSH host format', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const invalidRemoteContext: ResolvedContext = {
        ...mockContext,
        deployment: {
          type: 'docker-compose',
          docker: {
            host: 'ssh://invalid-format', // Missing user@
            remoteDir: '/opt/test',
          },
        },
      } as any;

      const plan = await strategy.prepare(mockService, invalidRemoteContext, {});
      const result = await strategy.validate(plan);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('Invalid SSH host format'));
    });
  });

  describe('execute()', () => {
    it('should return success result on successful deployment', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const plan = await strategy.prepare(mockService, mockContext, {});
      const result = await strategy.execute(plan);

      expect(result.status).toBe('success');
      expect(result.service).toBe('test-service');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.metadata?.containerId).toContain('bitbrat-local-test-service');
    });

    it('should return failed result on orchestrator error', async () => {
      mockFs.existsSync.mockReturnValue(true);

      // Mock orchestrator to throw error
      const { DockerOrchestrator } = require('../docker/orchestrator');
      DockerOrchestrator.mockImplementationOnce(() => ({
        up: jest.fn().mockRejectedValue(new Error('Build failed')),
      }));

      const plan = await strategy.prepare(mockService, mockContext, {});
      const result = await strategy.execute(plan);

      expect(result.status).toBe('failed');
      expect(result.error).toBe('Build failed');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('deployAll() - Sprint 378', () => {
    let mockServices: ServiceWithName[];

    beforeEach(() => {
      mockServices = [
        {
          name: 'service-a',
          active: true,
          entry: 'dist/apps/service-a.js',
          port: 3001,
        },
        {
          name: 'service-b',
          active: true,
          entry: 'dist/apps/service-b.js',
          port: 3002,
        },
        {
          name: 'service-c',
          active: true,
          entry: 'dist/apps/service-c.js',
          port: 3003,
        },
      ];
    });

    it('should deploy all services with no service-specific compose files', async () => {
      // Mock: No service-specific compose files exist
      mockFs.existsSync.mockImplementation((path: any) => {
        if (typeof path === 'string' && path.includes('services/')) {
          return false; // No service-specific files
        }
        return true; // Base compose exists
      });

      mockReadFile.mockResolvedValue(`
services:
  service-a:
    image: service-a:latest
  service-b:
    image: service-b:latest
  service-c:
    image: service-c:latest
`);

      const results = await strategy.deployAll(mockServices, mockContext, {});

      // Debug: Log results to see what's failing
      if (!results.every(r => r.status === 'success')) {
        console.log('Failed deployments:', results.filter(r => r.status !== 'success'));
      }

      expect(results).toHaveLength(3);
      expect(results.every(r => r.status === 'success')).toBe(true);
      expect(results[0].service).toBe('service-a');
      expect(results[1].service).toBe('service-b');
      expect(results[2].service).toBe('service-c');
    });

    it('should collect and merge service-specific compose files', async () => {
      // Mock: Service A and B have service-specific compose files
      mockFs.existsSync.mockImplementation((path: any) => {
        if (typeof path === 'string') {
          if (path.includes('service-a.compose.yaml')) return true;
          if (path.includes('service-b.compose.yaml')) return true;
          if (path.includes('service-c.compose.yaml')) return false;
          if (path.includes('.docker-compose.merged.yaml')) return true; // For cleanup
        }
        return true; // Base compose exists
      });

      const baseYaml = `
services:
  service-a:
    image: service-a:latest
  service-b:
    image: service-b:latest
  service-c:
    image: service-c:latest
`;

      const serviceAYaml = `
services:
  service-a:
    volumes:
      - /data:/data
    environment:
      CUSTOM_VAR: value-a
`;

      const serviceBYaml = `
services:
  service-b:
    volumes:
      - /logs:/logs
    environment:
      CUSTOM_VAR: value-b
`;

      mockReadFile.mockImplementation((path: string) => {
        if (typeof path === 'string') {
          if (path.includes('service-a.compose.yaml')) return Promise.resolve(serviceAYaml);
          if (path.includes('service-b.compose.yaml')) return Promise.resolve(serviceBYaml);
        }
        return Promise.resolve(baseYaml);
      });

      const results = await strategy.deployAll(mockServices, mockContext, {});

      expect(results).toHaveLength(3);
      expect(results.every(r => r.status === 'success')).toBe(true);

      // Verify merged file was written
      expect(mockWriteFile).toHaveBeenCalled();
      const writeCall = mockWriteFile.mock.calls.find((call: any) =>
        call[0].includes('.docker-compose.merged.yaml')
      );
      expect(writeCall).toBeDefined();
    });

    it('should handle secureFiles in local deployment', async () => {
      const servicesWithSecureFiles: ServiceWithName[] = [
        {
          ...mockServices[0],
          secureFiles: [
            {
              local: '.secure.local/test-creds.json',
              target: '/var/secrets/test-creds.json',
              env: 'TEST_CREDENTIALS',
              permissions: '0400',
              required: true,
            },
          ],
        } as any,
        mockServices[1],
      ];

      mockFs.existsSync.mockImplementation((path: any) => {
        if (typeof path === 'string') {
          if (path.includes('services/')) return false;
          if (path.includes('.secure.local/test-creds.json')) return true;
          if (path.includes('.docker-compose.merged.yaml')) return true;
        }
        return true;
      });

      mockReadFile.mockResolvedValue(`
services:
  service-a:
    image: service-a:latest
  service-b:
    image: service-b:latest
`);

      const results = await strategy.deployAll(
        servicesWithSecureFiles,
        mockContext,
        {}
      );

      expect(results).toHaveLength(2);
      expect(results.every(r => r.status === 'success')).toBe(true);

      // Verify merged file includes secureFiles env var and volume mount
      const writeCall = mockWriteFile.mock.calls.find((call: any) =>
        call[0].includes('.docker-compose.merged.yaml')
      );
      expect(writeCall).toBeDefined();
      const mergedContent = writeCall![1];
      expect(mergedContent).toContain('TEST_CREDENTIALS');
    });

    it('should handle file read errors gracefully', async () => {
      mockFs.existsSync.mockImplementation((path: any) => {
        if (typeof path === 'string' && path.includes('service-a.compose.yaml')) {
          return true;
        }
        return true;
      });

      mockReadFile.mockImplementation((path: string) => {
        if (typeof path === 'string' && path.includes('service-a.compose.yaml')) {
          return Promise.reject(new Error('Permission denied'));
        }
        return Promise.resolve(`
services:
  service-a:
    image: service-a:latest
`);
      });

      const results = await strategy.deployAll(mockServices, mockContext, {});

      // Should fail due to file read error
      expect(results).toHaveLength(3);
      expect(results.every(r => r.status === 'failed')).toBe(true);
      expect(results[0].error).toContain('Permission denied');
    });

    it('should handle merge errors gracefully', async () => {
      mockFs.existsSync.mockImplementation((path: any) => {
        if (typeof path === 'string' && path.includes('service-a.compose.yaml')) {
          return true;
        }
        return true;
      });

      const invalidYaml = `
services:
  service-a:
    invalid: yaml: structure:::
`;

      mockReadFile.mockImplementation((path: string) => {
        if (typeof path === 'string' && path.includes('service-a.compose.yaml')) {
          return Promise.resolve(invalidYaml);
        }
        return Promise.resolve(`
services:
  service-a:
    image: service-a:latest
`);
      });

      const results = await strategy.deployAll(mockServices, mockContext, {});

      // Should fail due to merge error (invalid YAML)
      expect(results).toHaveLength(3);
      expect(results.every(r => r.status === 'failed')).toBe(true);
    });

    it('should cleanup temporary merged file even on error', async () => {
      mockFs.existsSync.mockReturnValue(true);

      // Mock orchestrator to throw error
      const { DockerOrchestrator } = require('../docker/orchestrator');
      DockerOrchestrator.mockImplementationOnce(() => ({
        up: jest.fn().mockRejectedValue(new Error('Deployment failed')),
      }));

      mockReadFile.mockResolvedValue(`
services:
  service-a:
    image: service-a:latest
`);

      const mockUnlink = jest.fn().mockResolvedValue(undefined);
      (mockFs.promises as any).unlink = mockUnlink;

      const results = await strategy.deployAll(mockServices, mockContext, {});

      expect(results.every(r => r.status === 'failed')).toBe(true);

      // Verify cleanup was attempted (unlink called)
      expect(mockUnlink).toHaveBeenCalledWith(
        expect.stringContaining('.docker-compose.merged.yaml')
      );
    });

    it('should pass custom composeFile to orchestrator', async () => {
      mockFs.existsSync.mockImplementation((path: any) => {
        if (typeof path === 'string' && path.includes('services/')) {
          return false;
        }
        return true;
      });

      mockReadFile.mockResolvedValue(`
services:
  service-a:
    image: service-a:latest
`);

      const { DockerOrchestrator } = require('../docker/orchestrator');
      const mockUp = jest.fn().mockResolvedValue(undefined);
      const mockOrchestratorInstance = { up: mockUp };
      DockerOrchestrator.mockImplementationOnce(() => mockOrchestratorInstance);

      await strategy.deployAll(mockServices, mockContext, {});

      // Verify DockerOrchestrator was called with composeFile option
      expect(DockerOrchestrator).toHaveBeenCalledWith(
        expect.objectContaining({
          composeFile: expect.stringContaining('.docker-compose.merged.yaml'),
        })
      );
    });

    it('should return correct duration for all services', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(`
services:
  service-a:
    image: service-a:latest
`);

      const results = await strategy.deployAll(mockServices, mockContext, {});

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
        expect(result.durationMs).toBeLessThan(10000); // Should be fast (< 10s)
      });
    });

    it('should handle dry-run mode correctly', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(`
services:
  service-a:
    image: service-a:latest
`);

      const { DockerOrchestrator } = require('../docker/orchestrator');
      const mockUp = jest.fn().mockResolvedValue(undefined);
      DockerOrchestrator.mockImplementationOnce(() => ({ up: mockUp }));

      await strategy.deployAll(mockServices, mockContext, { dryRun: true });

      // Verify dry-run was passed to orchestrator
      expect(DockerOrchestrator).toHaveBeenCalledWith(
        expect.objectContaining({
          dryRun: true,
        })
      );
    });
  });
});

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
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
  },
}));

import * as fs from 'fs';
const mockFs = fs as jest.Mocked<typeof fs>;
const mockReadFile = (mockFs.promises.readFile as jest.MockedFunction<any>);
const mockWriteFile = (mockFs.promises.writeFile as jest.MockedFunction<any>);

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
});

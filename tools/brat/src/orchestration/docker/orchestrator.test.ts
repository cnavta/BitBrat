/**
 * Unit tests for Docker Orchestrator - PortManager Integration
 *
 * @module orchestration/docker/orchestrator.test
 * @since Sprint 379
 */

import { DockerOrchestrator } from './orchestrator';
import type { DockerOrchestratorOptions } from './orchestrator';
import * as fs from 'fs';
import * as path from 'path';

// Mock dependencies
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  readFileSync: jest.fn(),
}));
jest.mock('./environment-resolver');
jest.mock('./compose-factory');
jest.mock('./port-manager');
jest.mock('../../config/loader');
jest.mock('../../context/context-resolver');
jest.mock('./base-cache');
jest.mock('../exec');

describe('DockerOrchestrator - PortManager Integration (Sprint 379)', () => {
  let mockPortManager: any;
  let mockComposeFactory: any;
  let mockEnvResolver: any;
  let mockExecCmd: any;
  let MockedEnvironmentResolver: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock PortManager
    mockPortManager = {
      resolvePorts: jest.fn().mockResolvedValue([]),
      getEnvOverrides: jest.fn().mockReturnValue({}),
    };

    // Mock ComposeFactory
    mockComposeFactory = {
      getComposeFiles: jest.fn().mockReturnValue({
        baseFile: 'docker-compose.local.yaml',
        serviceFiles: ['services/llm-bot.compose.yaml'],
        targetService: 'llm-bot',
      }),
    };

    // Mock EnvironmentResolver
    mockEnvResolver = {
      resolve: jest.fn().mockReturnValue({
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug',
      }),
    };

    // Mock execCmd
    mockExecCmd = jest.fn().mockResolvedValue({
      code: 0,
      stdout: '',
      stderr: '',
    });

    // Setup module mocks
    const { PortManager } = require('./port-manager');
    PortManager.mockImplementation(() => mockPortManager);

    const { ComposeFactory } = require('./compose-factory');
    ComposeFactory.mockImplementation(() => mockComposeFactory);

    const { EnvironmentResolver } = require('./environment-resolver');
    EnvironmentResolver.mockImplementation(() => mockEnvResolver);
    EnvironmentResolver.flattenToDotEnv = jest.fn().mockReturnValue('NODE_ENV=development\n');
    MockedEnvironmentResolver = EnvironmentResolver;

    const { execCmd } = require('../exec');
    execCmd.mockImplementation(mockExecCmd);

    // Reset fs mocks
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
    (fs.unlinkSync as jest.Mock).mockImplementation(() => {});

    // Mock config loader
    const { loadArchitecture, resolveServices } = require('../../config/loader');
    loadArchitecture.mockResolvedValue({
      services: {},
      executionContexts: {},
    });
    resolveServices.mockResolvedValue([]);

    // Mock context resolver
    const { ContextResolver } = require('../../context/context-resolver');
    ContextResolver.mockImplementation(() => ({
      resolve: jest.fn().mockResolvedValue({
        name: 'local',
        deployment: { type: 'docker-compose', docker: {} },
      }),
    }));

    // Mock base cache
    const { shouldRebuildBase, computeBaseCacheKey, storeCacheKey } = require('./base-cache');
    shouldRebuildBase.mockResolvedValue(false);
    computeBaseCacheKey.mockReturnValue('cache-key');
    storeCacheKey.mockResolvedValue(undefined);
  });

  describe('Bulk Deployment Port Assignment (Task 379-008)', () => {
    it('should resolve ports for all services when allServiceNames provided', async () => {
      // Given: orchestrator with allServiceNames
      const options: DockerOrchestratorOptions = {
        repoRoot: '/test/repo',
        context: 'local',
        allServiceNames: ['llm-bot', 'tool-gateway', 'auth'],
        composeFile: '/test/repo/.docker-compose.merged.yaml',
      };

      const mockAssignments = [
        { service: 'llm-bot', port: 3001, explicit: false },
        { service: 'tool-gateway', port: 3002, explicit: false },
        { service: 'auth', port: 3003, explicit: false },
      ];

      mockPortManager.resolvePorts.mockResolvedValue(mockAssignments);
      mockPortManager.getEnvOverrides.mockReturnValue({
        LLM_BOT_HOST_PORT: '3001',
        TOOL_GATEWAY_HOST_PORT: '3002',
        AUTH_HOST_PORT: '3003',
      });

      const orchestrator = new DockerOrchestrator(options);

      // When: writeEnvFile called (via up() → prepare() → writeEnvFile())
      // Access private method for testing
      await (orchestrator as any).writeEnvFile('local', {});

      // Then: PortManager called with service file paths
      expect(mockPortManager.resolvePorts).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.stringContaining('llm-bot.compose.yaml'),
          expect.stringContaining('tool-gateway.compose.yaml'),
          expect.stringContaining('auth.compose.yaml'),
        ]),
        expect.any(Object),
        expect.any(Object)
      );

      // Verify all service files constructed correctly
      const calledWith = mockPortManager.resolvePorts.mock.calls[0][0];
      expect(calledWith).toHaveLength(3);
      expect(calledWith[0]).toContain('infrastructure/docker-compose/services/llm-bot.compose.yaml');
      expect(calledWith[1]).toContain('infrastructure/docker-compose/services/tool-gateway.compose.yaml');
      expect(calledWith[2]).toContain('infrastructure/docker-compose/services/auth.compose.yaml');
    });

    it('should use factory-generated service files when allServiceNames not provided', async () => {
      // Given: orchestrator without allServiceNames (single-service mode)
      const options: DockerOrchestratorOptions = {
        repoRoot: '/test/repo',
        context: 'local',
        service: 'llm-bot',
      };

      const orchestrator = new DockerOrchestrator(options);

      // When: writeEnvFile called
      await (orchestrator as any).writeEnvFile('local', {});

      // Then: PortManager called with factory-generated service files
      expect(mockPortManager.resolvePorts).toHaveBeenCalledWith(
        ['services/llm-bot.compose.yaml'],
        expect.any(Object),
        expect.any(Object)
      );

      // Verify factory was called
      expect(mockComposeFactory.getComposeFiles).toHaveBeenCalledWith('llm-bot', undefined, undefined);
    });

    it('should handle missing service compose files gracefully', async () => {
      // Given: orchestrator with allServiceNames, but some files missing
      const options: DockerOrchestratorOptions = {
        repoRoot: '/test/repo',
        context: 'local',
        allServiceNames: ['llm-bot', 'missing-service', 'auth'],
        composeFile: '/test/repo/.docker-compose.merged.yaml',
      };

      // Mock file existence check
      (fs.existsSync as jest.Mock).mockImplementation((filePath: any) => {
        return !filePath.toString().includes('missing-service');
      });

      const orchestrator = new DockerOrchestrator(options);

      // Spy on console.warn
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      // When: writeEnvFile called
      // Then: Should not throw, only warn
      await expect((orchestrator as any).writeEnvFile('local', {})).resolves.not.toThrow();

      // Verify warning logged
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Some services missing compose files: missing-service')
      );

      consoleWarnSpy.mockRestore();
    });

    it('should generate port overrides for implicit port assignments', async () => {
      // Given: orchestrator with services needing auto-assigned ports
      const options: DockerOrchestratorOptions = {
        repoRoot: '/test/repo',
        context: 'local',
        allServiceNames: ['llm-bot', 'tool-gateway'],
        composeFile: '/test/repo/.docker-compose.merged.yaml',
      };

      const mockAssignments = [
        { service: 'llm-bot', port: 3001, explicit: false }, // Auto-assigned
        { service: 'tool-gateway', port: 5000, explicit: true }, // Explicit
      ];

      mockPortManager.resolvePorts.mockResolvedValue(mockAssignments);
      mockPortManager.getEnvOverrides.mockReturnValue({
        LLM_BOT_HOST_PORT: '3001', // Only implicit assignments
      });

      const orchestrator = new DockerOrchestrator(options);

      // When: writeEnvFile called
      const envFilePath = await (orchestrator as any).writeEnvFile('local', {});

      // Then: getEnvOverrides called with assignments
      expect(mockPortManager.getEnvOverrides).toHaveBeenCalledWith(mockAssignments);

      // Verify env file written
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(envFilePath).toBe('.env.brat');
    });
  });

  describe('Service File Path Construction (Task 379-009)', () => {
    it('should construct correct paths from service names', async () => {
      // Given: orchestrator with service names
      const options: DockerOrchestratorOptions = {
        repoRoot: '/Users/test/BitBratPlatform',
        context: 'local',
        allServiceNames: ['auth', 'llm-bot'],
        composeFile: '/test/.docker-compose.merged.yaml',
      };

      const orchestrator = new DockerOrchestrator(options);

      // When: writeEnvFile called
      await (orchestrator as any).writeEnvFile('local', {});

      // Then: Service file paths constructed correctly
      const calledWith = mockPortManager.resolvePorts.mock.calls[0][0];
      expect(calledWith[0]).toBe('/Users/test/BitBratPlatform/infrastructure/docker-compose/services/auth.compose.yaml');
      expect(calledWith[1]).toBe('/Users/test/BitBratPlatform/infrastructure/docker-compose/services/llm-bot.compose.yaml');
    });

    it('should handle empty allServiceNames array', async () => {
      // Given: orchestrator with empty allServiceNames and composeFile
      const options: DockerOrchestratorOptions = {
        repoRoot: '/test/repo',
        context: 'local',
        allServiceNames: [],
        composeFile: '/test/.docker-compose.merged.yaml',
      };

      const orchestrator = new DockerOrchestrator(options);

      // When: writeEnvFile called
      await (orchestrator as any).writeEnvFile('local', {});

      // Then: PortManager called with empty array (no services to assign ports)
      expect(mockPortManager.resolvePorts).toHaveBeenCalledWith(
        [],
        expect.any(Object),
        expect.any(Object)
      );

      // Factory NOT called because composeFile was provided
      expect(mockComposeFactory.getComposeFiles).not.toHaveBeenCalled();
    });

    it('should handle null/undefined allServiceNames', async () => {
      // Given: orchestrator without allServiceNames
      const options: DockerOrchestratorOptions = {
        repoRoot: '/test/repo',
        context: 'local',
        service: 'test-service',
      };

      const orchestrator = new DockerOrchestrator(options);

      // When: writeEnvFile called
      await (orchestrator as any).writeEnvFile('local', {});

      // Then: Uses factory-generated files (backward compatibility)
      expect(mockComposeFactory.getComposeFiles).toHaveBeenCalledWith('test-service', undefined, undefined);
      expect(mockPortManager.resolvePorts).toHaveBeenCalledWith(
        ['services/llm-bot.compose.yaml'],
        expect.any(Object),
        expect.any(Object)
      );
    });
  });

  describe('Backward Compatibility (Task 379-011)', () => {
    it('single-service deployment should work without allServiceNames', async () => {
      // Given: Traditional single-service deployment options
      const options: DockerOrchestratorOptions = {
        repoRoot: '/test/repo',
        context: 'local',
        service: 'llm-bot',
      };

      const mockAssignments = [
        { service: 'llm-bot', port: 3001, explicit: false },
      ];

      mockPortManager.resolvePorts.mockResolvedValue(mockAssignments);
      mockPortManager.getEnvOverrides.mockReturnValue({
        LLM_BOT_HOST_PORT: '3001',
      });

      const orchestrator = new DockerOrchestrator(options);

      // When: writeEnvFile called
      await expect((orchestrator as any).writeEnvFile('local', {})).resolves.not.toThrow();

      // Then: Factory used, PortManager called with factory files
      expect(mockComposeFactory.getComposeFiles).toHaveBeenCalledWith('llm-bot', undefined, undefined);
      expect(mockPortManager.resolvePorts).toHaveBeenCalled();
    });

    it('should not break existing env file generation', async () => {
      // Given: Single-service deployment
      const options: DockerOrchestratorOptions = {
        repoRoot: '/test/repo',
        context: 'local',
        service: 'test-service',
      };

      const orchestrator = new DockerOrchestrator(options);

      // When: writeEnvFile called
      const envFilePath = await (orchestrator as any).writeEnvFile('local', {});

      // Then: Env file format unchanged
      expect(envFilePath).toBe('.env.brat');
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('.env.brat'),
        expect.any(String)
      );

      // Verify EnvironmentResolver.flattenToDotEnv called
      expect(MockedEnvironmentResolver.flattenToDotEnv).toHaveBeenCalled();
    });

    it('should maintain existing orchestrator behavior', async () => {
      // Given: Standard orchestrator setup
      const options: DockerOrchestratorOptions = {
        repoRoot: '/test/repo',
        context: 'local',
        service: 'test-service',
      };

      const orchestrator = new DockerOrchestrator(options);

      // When: writeEnvFile called
      await (orchestrator as any).writeEnvFile('local', {});

      // Then: All existing components still called
      expect(mockEnvResolver.resolve).toHaveBeenCalled();
      expect(mockComposeFactory.getComposeFiles).toHaveBeenCalled();
      expect(mockPortManager.resolvePorts).toHaveBeenCalled();
      expect(mockPortManager.getEnvOverrides).toHaveBeenCalled();
      expect(MockedEnvironmentResolver.flattenToDotEnv).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('Logging and Visibility (Sprint 379)', () => {
    it('should log service names when using allServiceNames', async () => {
      // Given: Bulk deployment with service names
      const options: DockerOrchestratorOptions = {
        repoRoot: '/test/repo',
        context: 'local',
        allServiceNames: ['auth', 'llm-bot', 'tool-gateway'],
        composeFile: '/test/.docker-compose.merged.yaml',
      };

      const orchestrator = new DockerOrchestrator(options);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      // When: writeEnvFile called
      await (orchestrator as any).writeEnvFile('local', {});

      // Then: Logging shows service names
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using allServiceNames for port resolution: auth, llm-bot, tool-gateway')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Constructed 3 service file paths for PortManager')
      );

      consoleLogSpy.mockRestore();
    });

    it('should log port assignments', async () => {
      // Given: Orchestrator with port assignments
      const options: DockerOrchestratorOptions = {
        repoRoot: '/test/repo',
        context: 'local',
        allServiceNames: ['llm-bot'],
        composeFile: '/test/.docker-compose.merged.yaml',
      };

      const mockAssignments = [
        { service: 'llm-bot', port: 3001, explicit: false },
      ];

      mockPortManager.resolvePorts.mockResolvedValue(mockAssignments);

      const orchestrator = new DockerOrchestrator(options);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      // When: writeEnvFile called
      await (orchestrator as any).writeEnvFile('local', {});

      // Then: Port assignments logged
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Port assignments: llm-bot:3001(auto)')
      );

      consoleLogSpy.mockRestore();
    });

    it('should log explicit vs auto-assigned ports', async () => {
      // Given: Mix of explicit and auto-assigned ports
      const options: DockerOrchestratorOptions = {
        repoRoot: '/test/repo',
        context: 'local',
        allServiceNames: ['llm-bot', 'tool-gateway'],
        composeFile: '/test/.docker-compose.merged.yaml',
      };

      const mockAssignments = [
        { service: 'llm-bot', port: 3001, explicit: false },
        { service: 'tool-gateway', port: 5000, explicit: true },
      ];

      mockPortManager.resolvePorts.mockResolvedValue(mockAssignments);

      const orchestrator = new DockerOrchestrator(options);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      // When: writeEnvFile called
      await (orchestrator as any).writeEnvFile('local', {});

      // Then: Both explicit and auto shown
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/llm-bot:3001\(auto\).*tool-gateway:5000\(explicit\)/)
      );

      consoleLogSpy.mockRestore();
    });
  });
});

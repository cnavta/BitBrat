/**
 * Registry Resolver Module Unit Tests
 * Sprint 360: Test suite for business/registry-resolver.ts
 */

import { resolveRegistry, RegistryResolutionOptions } from './registry-resolver';
import { ContextResolver } from '../context/context-resolver';
import { getCurrentContext } from '../config/bratrc';
import type { FleetDeps } from './fleet-deps';
import type { Logger } from '../orchestration/logger';

// Mock dependencies
jest.mock('../context/context-resolver');
jest.mock('../config/bratrc');

const mockContextResolver = ContextResolver as jest.MockedClass<typeof ContextResolver>;
const mockGetCurrentContext = getCurrentContext as jest.MockedFunction<typeof getCurrentContext>;

describe('Registry Resolver Business Logic', () => {
  const repoRoot = '/test/repo';
  const mockLogger: Logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as any;

  let mockDeps: FleetDeps;
  let mockRegistry: any;
  let mockResolve: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock registry
    mockRegistry = {
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue(null),
    };

    // Default mock deps
    mockDeps = {
      registryFactory: jest.fn().mockReturnValue(mockRegistry),
      connectionResolverFn: jest.fn().mockResolvedValue({
        connectOptions: { projectId: 'test-project' },
        isEmulator: true,
        targetKind: 'local' as const,
        description: 'Firestore Emulator',
      }),
    };

    // Mock ContextResolver.resolve()
    mockResolve = jest.fn();
    mockContextResolver.mockImplementation(() => ({
      resolve: mockResolve,
    } as any));

    // Mock getCurrentContext
    mockGetCurrentContext.mockReturnValue('local');
  });

  describe('PostgreSQL Registry Resolution (Sprint 349+)', () => {
    beforeEach(() => {
      mockResolve.mockResolvedValue({
        deployment: {
          type: 'docker-compose',
          docker: { host: 'unix:///var/run/docker.sock' },
        },
        runtime: {
          persistence: {
            driver: 'postgres',
            connection: {
              host: 'localhost',
              port: 5432,
              database: 'bitbrat',
              username: 'bitbrat',
              password: 'test_password',
            },
          },
        },
      });
    });

    it('should resolve PostgreSQL registry from context', async () => {
      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
        contextName: 'local',
      };

      const result = await resolveRegistry(options);

      expect(result.registry).toBeDefined();
      expect(result.isLocalDocker).toBe(true);
      expect(result.description).toContain('PostgreSQL');
      expect(result.description).toContain('localhost:5432/bitbrat');
    });

    it('should log PostgreSQL registry resolution', async () => {
      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
        contextName: 'local',
      };

      await resolveRegistry(options);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'fleet.registry.resolved',
          context: 'local',
          driver: 'postgres',
          host: 'localhost',
        }),
        expect.stringContaining('PostgreSQL')
      );
    });

    it('should use context name from flag over environment', async () => {
      process.env.BITBRAT_CONTEXT = 'staging';

      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
        contextName: 'prod',
      };

      await resolveRegistry(options);

      expect(mockResolve).toHaveBeenCalledWith('prod');
    });

    it('should use BITBRAT_CONTEXT env var when no flag provided', async () => {
      process.env.BITBRAT_CONTEXT = 'staging';

      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
      };

      await resolveRegistry(options);

      expect(mockResolve).toHaveBeenCalledWith('staging');

      delete process.env.BITBRAT_CONTEXT;
    });

    it('should use getCurrentContext() when no flag or env var', async () => {
      mockGetCurrentContext.mockReturnValue('dev');

      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
      };

      await resolveRegistry(options);

      expect(mockResolve).toHaveBeenCalledWith('dev');
    });

    it('should default to "local" context when no configuration', async () => {
      mockGetCurrentContext.mockReturnValue(null);

      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
      };

      await resolveRegistry(options);

      expect(mockResolve).toHaveBeenCalledWith('local');
    });

    it('should throw error when PostgreSQL connection not configured', async () => {
      mockResolve.mockResolvedValue({
        deployment: { type: 'docker-compose' },
        runtime: {
          persistence: {
            driver: 'postgres',
            // Missing connection
          },
        },
      });

      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
        contextName: 'broken',
      };

      await expect(resolveRegistry(options)).rejects.toThrow(
        "PostgreSQL connection not configured for context 'broken'"
      );
    });

    it('should detect local Docker environment', async () => {
      mockResolve.mockResolvedValue({
        deployment: {
          type: 'docker-compose',
          docker: { host: 'unix:///var/run/docker.sock' },
        },
        runtime: {
          persistence: {
            driver: 'postgres',
            connection: {
              host: 'localhost',
              port: 5432,
              database: 'bitbrat',
              username: 'bitbrat',
              password: 'test_password',
            },
          },
        },
      });

      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
      };

      const result = await resolveRegistry(options);

      expect(result.isLocalDocker).toBe(true);
    });

    it('should detect non-local Docker environment', async () => {
      mockResolve.mockResolvedValue({
        deployment: {
          type: 'docker-compose',
          docker: { host: 'ssh://root@remote-host' },
        },
        runtime: {
          persistence: {
            driver: 'postgres',
            connection: {
              host: 'remote-host',
              port: 5432,
              database: 'bitbrat',
              username: 'bitbrat',
              password: 'test_password',
            },
          },
        },
      });

      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
      };

      const result = await resolveRegistry(options);

      expect(result.isLocalDocker).toBe(false);
    });
  });

  describe('Firestore Registry Resolution (Sprint 349+)', () => {
    beforeEach(() => {
      mockResolve.mockResolvedValue({
        deployment: {
          type: 'docker-compose',
          docker: { host: 'unix:///var/run/docker.sock' },
        },
        runtime: {
          persistence: {
            driver: 'firestore',
          },
        },
      });
    });

    it('should resolve Firestore registry from context', async () => {
      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
        contextName: 'local',
      };

      const result = await resolveRegistry(options);

      expect(result.registry).toBe(mockRegistry);
      expect(result.isLocalDocker).toBe(true);
      expect(result.description).toBe('Firestore');
    });

    it('should pass connectOptions to registryFactory', async () => {
      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
        contextName: 'local',
        legacyProjectId: 'custom-project',
        legacyEmulatorHost: 'localhost:8080',
        legacyDatabase: 'custom-db',
      };

      await resolveRegistry(options);

      expect(mockDeps.registryFactory).toHaveBeenCalledWith(
        {
          projectId: 'custom-project',
          emulatorHost: 'localhost:8080',
          databaseId: 'custom-db',
        },
        mockLogger
      );
    });

    it('should log Firestore registry resolution', async () => {
      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
        contextName: 'local',
      };

      await resolveRegistry(options);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'fleet.registry.resolved',
          context: 'local',
          driver: 'firestore',
        }),
        expect.stringContaining('Firestore')
      );
    });

    it('should throw error when registryFactory not provided', async () => {
      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: {}, // No registryFactory
        logger: mockLogger,
        contextName: 'local',
      };

      await expect(resolveRegistry(options)).rejects.toThrow(
        'FleetDeps.registryFactory not provided'
      );
    });
  });

  describe('Legacy --target Flag Resolution (Backward Compatibility)', () => {
    it('should use legacy path when --target flag provided', async () => {
      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
        legacyTarget: 'emulator',
        legacyProjectId: 'test-project',
      };

      const result = await resolveRegistry(options);

      expect(result.registry).toBe(mockRegistry);
      expect(result.isLocalDocker).toBe(true);
      expect(result.description).toBe('Firestore Emulator');
    });

    it('should pass all legacy flags to connectionResolverFn', async () => {
      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
        legacyTarget: 'emulator',
        legacyProjectId: 'test-project',
        legacyEmulatorHost: 'localhost:8080',
        legacyDatabase: 'test-db',
      };

      await resolveRegistry(options);

      expect(mockDeps.connectionResolverFn).toHaveBeenCalledWith(
        { projectId: 'test-project' },
        {
          target: 'emulator',
          'project-id': 'test-project',
          'emulator-host': 'localhost:8080',
          database: 'test-db',
        },
        mockLogger
      );
    });

    it('should log legacy target resolution', async () => {
      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
        legacyTarget: 'emulator',
      };

      await resolveRegistry(options);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'fleet.target.resolved',
          target: 'emulator',
          isEmulator: true,
          kind: 'local',
        }),
        expect.stringContaining('Firestore Emulator')
      );
    });

    it('should return cleanup function from legacy resolver', async () => {
      const mockCleanup = jest.fn();
      mockDeps.connectionResolverFn = jest.fn().mockResolvedValue({
        connectOptions: { projectId: 'test-project' },
        isEmulator: true,
        targetKind: 'local' as const,
        description: 'Firestore Emulator',
        cleanup: mockCleanup,
      });

      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
        legacyTarget: 'emulator',
      };

      const result = await resolveRegistry(options);

      expect(result.cleanup).toBe(mockCleanup);
    });

    it('should throw error when connectionResolverFn not provided with legacy target', async () => {
      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: { registryFactory: mockDeps.registryFactory }, // Missing connectionResolverFn
        logger: mockLogger,
        legacyTarget: 'emulator',
      };

      await expect(resolveRegistry(options)).rejects.toThrow(
        'FleetDeps.connectionResolverFn and registryFactory required for legacy target'
      );
    });

    it('should throw error when registryFactory not provided with legacy target', async () => {
      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: { connectionResolverFn: mockDeps.connectionResolverFn }, // Missing registryFactory
        logger: mockLogger,
        legacyTarget: 'emulator',
      };

      await expect(resolveRegistry(options)).rejects.toThrow(
        'FleetDeps.connectionResolverFn and registryFactory required for legacy target'
      );
    });
  });

  describe('Fallback Behavior', () => {
    it('should fallback to Firestore when context resolution fails', async () => {
      mockResolve.mockRejectedValue(new Error('Context not found'));

      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
        contextName: 'nonexistent',
      };

      const result = await resolveRegistry(options);

      expect(result.registry).toBe(mockRegistry);
      expect(result.isLocalDocker).toBe(false);
      expect(result.description).toBe('Firestore');
    });

    it('should log fallback warning with error message', async () => {
      mockResolve.mockRejectedValue(new Error('Context not found'));

      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
        contextName: 'nonexistent',
      };

      await resolveRegistry(options);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'fleet.registry.fallback',
          error: 'Context not found',
        }),
        expect.stringContaining('Context resolution failed')
      );
    });

    it('should use legacy flags in fallback when provided', async () => {
      mockResolve.mockRejectedValue(new Error('Context not found'));

      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
        contextName: 'nonexistent',
        legacyProjectId: 'fallback-project',
        legacyEmulatorHost: 'localhost:9000',
      };

      await resolveRegistry(options);

      expect(mockDeps.registryFactory).toHaveBeenCalledWith(
        {
          projectId: 'fallback-project',
          emulatorHost: 'localhost:9000',
          databaseId: undefined,
        },
        mockLogger
      );
    });
  });

  describe('Unknown Persistence Driver', () => {
    it('should throw error for unknown persistence driver', async () => {
      mockResolve.mockResolvedValue({
        deployment: { type: 'docker-compose' },
        runtime: {
          persistence: {
            driver: 'unknown-driver',
          },
        },
      });

      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
        contextName: 'broken',
      };

      await expect(resolveRegistry(options)).rejects.toThrow(
        "Unknown persistence driver for context 'broken': unknown-driver"
      );
    });
  });

  describe('Priority Resolution', () => {
    it('should prioritize legacy --target flag over context resolution', async () => {
      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
        contextName: 'local',
        legacyTarget: 'emulator',
      };

      await resolveRegistry(options);

      // Should NOT call ContextResolver when legacyTarget present
      expect(mockResolve).not.toHaveBeenCalled();

      // Should call legacy path
      expect(mockDeps.connectionResolverFn).toHaveBeenCalled();
    });

    it('should use context resolution when no legacy flags', async () => {
      mockResolve.mockResolvedValue({
        deployment: { type: 'docker-compose', docker: { host: 'unix://' } },
        runtime: {
          persistence: {
            driver: 'postgres',
            connection: {
              host: 'localhost',
              port: 5432,
              database: 'bitbrat',
              username: 'bitbrat',
              password: 'test_password',
            },
          },
        },
      });

      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
      };

      await resolveRegistry(options);

      // Should call ContextResolver
      expect(mockResolve).toHaveBeenCalled();

      // Should NOT call legacy path
      expect(mockDeps.connectionResolverFn).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle context with no docker host', async () => {
      mockResolve.mockResolvedValue({
        deployment: {
          type: 'docker-compose',
          // No docker property
        },
        runtime: {
          persistence: {
            driver: 'postgres',
            connection: {
              host: 'localhost',
              port: 5432,
              database: 'bitbrat',
              username: 'bitbrat',
              password: 'test_password',
            },
          },
        },
      });

      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
      };

      const result = await resolveRegistry(options);

      expect(result.isLocalDocker).toBe(false);
    });

    it('should handle cloud-run deployment type', async () => {
      mockResolve.mockResolvedValue({
        deployment: {
          type: 'cloud-run',
        },
        runtime: {
          persistence: {
            driver: 'postgres',
            connection: {
              host: 'cloudsql-instance',
              port: 5432,
              database: 'bitbrat',
              username: 'bitbrat',
              password: 'prod_password',
            },
          },
        },
      });

      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
        contextName: 'prod',
      };

      const result = await resolveRegistry(options);

      expect(result.isLocalDocker).toBe(false);
      expect(result.description).toContain('cloudsql-instance');
    });

    it('should handle empty legacy flags gracefully', async () => {
      const options: RegistryResolutionOptions = {
        repoRoot,
        deps: mockDeps,
        logger: mockLogger,
        legacyTarget: 'emulator',
        // No other legacy flags
      };

      await resolveRegistry(options);

      expect(mockDeps.connectionResolverFn).toHaveBeenCalledWith(
        { projectId: undefined },
        { target: 'emulator' },
        mockLogger
      );
    });
  });
});

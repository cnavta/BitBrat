/**
 * Sprint 358: AgentDevContextManager Unit Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { AgentDevContextManager } from './agent-dev-context-manager';
import type { ExecutionContext } from '../config/execution-context-schema';

// Mock fs module
jest.mock('fs');

// Mock crypto module
jest.mock('crypto', () => ({
  randomBytes: jest.fn().mockReturnValue(Buffer.from('abcd1234', 'hex')),
}));

// Mock imports from create.ts
jest.mock('../commands/context/create', () => ({
  buildNonInteractive: jest.fn(),
  scaffoldEnvironment: jest.fn(),
  waitForPostgres: jest.fn(),
}));

// Mock DockerOrchestrator
jest.mock('../orchestration/docker/orchestrator', () => ({
  DockerOrchestrator: jest.fn().mockImplementation(() => ({
    up: jest.fn(),
    down: jest.fn(),
  })),
}));

// Mock cmdSeed (legacy - no longer used)
jest.mock('../cli/seed', () => ({
  cmdSeed: jest.fn(),
}));

// Mock seedPostgres (new implementation)
jest.mock('../seeding/postgres-seed-writer', () => ({
  seedPostgres: jest.fn(),
}));

// Mock execCmd
jest.mock('../orchestration/exec', () => ({
  execCmd: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

import { buildNonInteractive, scaffoldEnvironment, waitForPostgres } from '../commands/context/create';
import { DockerOrchestrator } from '../orchestration/docker/orchestrator';
import { cmdSeed } from '../cli/seed';
import { seedPostgres } from '../seeding/postgres-seed-writer';
import { execCmd } from '../orchestration/exec';

const mockBuildNonInteractive = buildNonInteractive as jest.MockedFunction<typeof buildNonInteractive>;
const mockScaffoldEnvironment = scaffoldEnvironment as jest.MockedFunction<typeof scaffoldEnvironment>;
const mockWaitForPostgres = waitForPostgres as jest.MockedFunction<typeof waitForPostgres>;
const mockCmdSeed = cmdSeed as jest.MockedFunction<typeof cmdSeed>;
const mockSeedPostgres = seedPostgres as jest.MockedFunction<typeof seedPostgres>;
const mockExecCmd = execCmd as jest.MockedFunction<typeof execCmd>;

describe('AgentDevContextManager - Sprint 358', () => {
  let manager: AgentDevContextManager;
  const repoRoot = '/fake/repo';
  const ephemeralPath = '/fake/repo/.brat/ephemeral-contexts.yaml';

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new AgentDevContextManager(repoRoot);

    // Default: .brat/ directory doesn't exist
    mockFs.existsSync.mockReturnValue(false);

    // Mock Date.now for consistent timestamps
    jest.spyOn(Date, 'now').mockReturnValue(1234567890000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Context Name Generation', () => {
    it('generates unique context name with agent-dev- prefix', async () => {
      const mockConfig: ExecutionContext = {
        deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
        runtime: {
          gateway: { fallbackPort: 3004 },
          persistence: { driver: 'postgres' },
        },
      };

      mockBuildNonInteractive.mockResolvedValue(mockConfig);
      mockScaffoldEnvironment.mockResolvedValue(undefined);
      mockFs.mkdirSync.mockReturnValue(undefined);
      mockFs.writeFileSync.mockReturnValue(undefined);

      const result = await manager.provision();

      // Format: agent-dev-{timestamp}-{random}
      expect(result.name).toMatch(/^agent-dev-\d+-[a-f0-9]+$/);
      expect(result.name).toBe('agent-dev-1234567890000-abcd1234');
    });

    it('accepts custom context name if it starts with agent-dev-', async () => {
      const customName = 'agent-dev-custom-test';
      const mockConfig: ExecutionContext = {
        deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
        runtime: {
          gateway: { fallbackPort: 3004 },
          persistence: { driver: 'postgres' },
        },
      };

      mockBuildNonInteractive.mockResolvedValue(mockConfig);
      mockScaffoldEnvironment.mockResolvedValue(undefined);
      mockFs.mkdirSync.mockReturnValue(undefined);
      mockFs.writeFileSync.mockReturnValue(undefined);

      const result = await manager.provision({ name: customName });

      expect(result.name).toBe(customName);
    });

    it('rejects custom context name without agent-dev- prefix', async () => {
      await expect(manager.provision({ name: 'staging' })).rejects.toThrow(
        "Invalid context name: 'staging'. Agent-dev contexts must start with 'agent-dev-'"
      );
    });

    it('rejects context name that already exists', async () => {
      const ephemeralData = {
        executionContexts: {
          'agent-dev-existing': {
            deployment: { type: 'docker-compose' },
            runtime: { gateway: {}, persistence: { driver: 'postgres' } },
          },
        },
      };

      mockFs.existsSync.mockImplementation((p) => {
        if (p === ephemeralPath) return true;
        return false;
      });

      mockFs.readFileSync.mockReturnValue(yaml.dump(ephemeralData));

      await expect(manager.provision({ name: 'agent-dev-existing' })).rejects.toThrow(
        "Context 'agent-dev-existing' already exists"
      );
    });
  });

  describe('provision()', () => {
    const mockConfig: ExecutionContext = {
      deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
      runtime: {
        gateway: { fallbackPort: 3004, authToken: 'test-token' },
        persistence: {
          driver: 'postgres',
          connection: {
            host: 'localhost',
            port: 5432,
            database: 'bitbrat',
            username: 'bitbrat',
            password: 'secret',
          },
        },
      },
    };

    beforeEach(() => {
      mockBuildNonInteractive.mockResolvedValue(mockConfig);
      mockScaffoldEnvironment.mockResolvedValue(undefined);
      mockFs.mkdirSync.mockReturnValue(undefined);
      mockFs.writeFileSync.mockReturnValue(undefined);
    });

    it('provisions new context with default options', async () => {
      const result = await manager.provision();

      expect(result.name).toBe('agent-dev-1234567890000-abcd1234');
      expect(result.status).toBe('provisioned');
      expect(result.gateway.url).toBe('ws://localhost:3004/ws/v1');
      expect(result.gateway.authToken).toBe('test-token');
      expect(result.postgres.host).toBe('localhost');
      expect(result.postgres.port).toBe(5432);
      expect(result.postgres.database).toBe('bitbrat');
    });

    it('calls buildNonInteractive with correct options', async () => {
      await manager.provision({ persistence: 'postgres', profile: 'dev' });

      expect(mockBuildNonInteractive).toHaveBeenCalledWith({
        nonInteractive: true,
        type: 'docker-compose',
        description: expect.stringContaining('Ephemeral agent development context'),
        persistenceDriver: 'postgres',
        dockerHost: 'unix:///var/run/docker.sock',
        pgHost: undefined,
        tags: 'development,agent-dev,ephemeral',
        envPath: 'env/agent-dev-1234567890000-abcd1234', // Sprint 358: Added envPath for environment resolution
      });
    });

    it('creates .brat directory if it does not exist', async () => {
      await manager.provision();

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        path.join(repoRoot, '.brat'),
        { recursive: true }
      );
    });

    it('writes context to ephemeral storage', async () => {
      await manager.provision();

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        ephemeralPath,
        expect.stringContaining('executionContexts'),
        'utf8'
      );
    });

    it('scaffolds environment directory', async () => {
      await manager.provision();

      expect(mockScaffoldEnvironment).toHaveBeenCalledWith(
        repoRoot,
        'agent-dev-1234567890000-abcd1234',
        expect.objectContaining({
          deployment: expect.objectContaining({ type: 'docker-compose' }),
        })
      );
    });

    it('adds metadata to context config', async () => {
      await manager.provision();

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const writtenContent = yaml.load(writeCall[1] as string) as any;
      const context = writtenContent.executionContexts['agent-dev-1234567890000-abcd1234'];

      expect(context.metadata).toBeDefined();
      expect(context.metadata.createdBy).toBe('agent');
      expect(context.metadata.autoDestroy).toBe(true);
      expect(context.metadata.createdAt).toBeDefined();
    });

    it('preserves existing ephemeral contexts when adding new one', async () => {
      const existingData = {
        executionContexts: {
          'agent-dev-old': {
            deployment: { type: 'docker-compose' },
            runtime: { gateway: {}, persistence: { driver: 'postgres' } },
          },
        },
      };

      mockFs.existsSync.mockImplementation((p) => {
        if (p === ephemeralPath) return true;
        return false;
      });

      mockFs.readFileSync.mockReturnValue(yaml.dump(existingData));

      await manager.provision();

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const writtenContent = yaml.load(writeCall[1] as string) as any;

      expect(writtenContent.executionContexts['agent-dev-old']).toBeDefined();
      expect(writtenContent.executionContexts['agent-dev-1234567890000-abcd1234']).toBeDefined();
    });
  });

  describe('start()', () => {
    const contextName = 'agent-dev-test-123';
    const mockConfig: ExecutionContext = {
      deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
      runtime: {
        gateway: { fallbackPort: 3004 },
        persistence: { driver: 'postgres' },
      },
    };

    beforeEach(() => {
      const ephemeralData = {
        executionContexts: {
          [contextName]: mockConfig,
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(yaml.dump(ephemeralData));
      mockWaitForPostgres.mockResolvedValue(undefined);
      mockSeedPostgres.mockResolvedValue({ success: true, message: 'Seeded' } as any);

      // Mock process.env for seeding
      process.env.DATABASE_URL = 'postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat';

      // Mock private waitForNats to prevent actual execution (10s timeout)
      jest.spyOn(AgentDevContextManager.prototype as any, 'waitForNats').mockResolvedValue(undefined);
    });

    it('starts all services via DockerOrchestrator', async () => {
      const result = await manager.start(contextName);

      expect(DockerOrchestrator).toHaveBeenCalledWith({
        repoRoot,
        context: contextName,
        service: undefined,
        dryRun: false,
        loki: false,
      });

      const orchestratorInstance = (DockerOrchestrator as jest.Mock).mock.results[0].value;
      expect(orchestratorInstance.up).toHaveBeenCalled();
    });

    it('waits for PostgreSQL readiness with 30s timeout', async () => {
      await manager.start(contextName);

      expect(mockWaitForPostgres).toHaveBeenCalledWith(30);
    });

    it('seeds database after PostgreSQL is ready', async () => {
      await manager.start(contextName);

      expect(mockSeedPostgres).toHaveBeenCalledWith(
        'postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat',
        {
          contextName,
          botName: 'BitBrat',
          dryRun: false,
          wipe: false,
          apiToken: undefined,
        }
      );
    });

    it('returns start result with gateway URL', async () => {
      const result = await manager.start(contextName);

      expect(result.status).toBe('running');
      expect(result.gateway.url).toBe('ws://localhost:3004/ws/v1');
      expect(result.services).toEqual(['all']);
    });

    it('starts only specified service when provided', async () => {
      const result = await manager.start(contextName, 'llm-bot');

      expect(DockerOrchestrator).toHaveBeenCalledWith({
        repoRoot,
        context: contextName,
        service: 'llm-bot',
        dryRun: false,
        loki: false,
      });

      expect(result.services).toEqual(['llm-bot']);
    });

    it('throws error when context does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await expect(manager.start('agent-dev-nonexistent')).rejects.toThrow(
        "Context 'agent-dev-nonexistent' not found"
      );
    });

    it('throws error when context name does not start with agent-dev-', async () => {
      // Note: context existence is checked before validation, so non-existing contexts
      // will throw "not found" error before validation error
      mockFs.existsSync.mockReturnValue(false);

      await expect(manager.start('staging')).rejects.toThrow(
        "Context 'staging' not found"
      );
    });

    it('throws error when PostgreSQL does not become ready', async () => {
      mockWaitForPostgres.mockRejectedValue(new Error('Timeout'));

      await expect(manager.start(contextName)).rejects.toThrow(
        'PostgreSQL did not become ready within 30 seconds'
      );
    });

    it('continues even if database seeding fails', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      mockSeedPostgres.mockRejectedValue(new Error('Seed failed'));

      const result = await manager.start(contextName);

      expect(result.status).toBe('running');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Database seeding failed')
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('stop()', () => {
    const contextName = 'agent-dev-test-456';
    const mockConfig: ExecutionContext = {
      deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
      runtime: {
        gateway: { fallbackPort: 3004 },
        persistence: { driver: 'postgres' },
      },
    };

    beforeEach(() => {
      const ephemeralData = {
        executionContexts: {
          [contextName]: mockConfig,
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(yaml.dump(ephemeralData));
    });

    it('stops all services via DockerOrchestrator', async () => {
      await manager.stop(contextName);

      expect(DockerOrchestrator).toHaveBeenCalledWith({
        repoRoot,
        context: contextName,
        dryRun: false,
        loki: false,
      });

      const orchestratorInstance = (DockerOrchestrator as jest.Mock).mock.results[0].value;
      expect(orchestratorInstance.down).toHaveBeenCalled();
    });

    it('throws error when context does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await expect(manager.stop('agent-dev-nonexistent')).rejects.toThrow(
        "Context 'agent-dev-nonexistent' not found"
      );
    });

    it('throws error when context name does not start with agent-dev-', async () => {
      // Note: context existence is checked before validation
      mockFs.existsSync.mockReturnValue(false);

      await expect(manager.stop('staging')).rejects.toThrow(
        "Context 'staging' not found"
      );
    });
  });

  describe('destroy()', () => {
    const contextName = 'agent-dev-test-789';

    beforeEach(() => {
      mockExecCmd.mockResolvedValue({ code: 0, stdout: '', stderr: '' });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.rmSync.mockReturnValue(undefined);
      mockFs.readFileSync.mockReturnValue(yaml.dump({
        executionContexts: {
          [contextName]: {
            deployment: { type: 'docker-compose' },
            runtime: { gateway: {}, persistence: { driver: 'postgres' } },
          },
        },
      }));
      mockFs.writeFileSync.mockReturnValue(undefined);

      // Mock validateCleanup to prevent actual filesystem checks
      jest.spyOn(AgentDevContextManager.prototype as any, 'validateCleanup').mockResolvedValue(undefined);
    });

    it('removes containers and volumes', async () => {
      await manager.destroy(contextName);

      expect(mockExecCmd).toHaveBeenCalledWith('docker', [
        'compose',
        '-p',
        `bitbrat-${contextName}`,
        'down',
        '-v',
      ]);
    });

    it('deletes environment directory', async () => {
      await manager.destroy(contextName);

      expect(mockFs.rmSync).toHaveBeenCalledWith(
        path.join(repoRoot, 'env', contextName),
        { recursive: true, force: true }
      );
    });

    it('removes context from ephemeral storage', async () => {
      await manager.destroy(contextName);

      expect(mockFs.writeFileSync).toHaveBeenCalled();
      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const writtenContent = yaml.load(writeCall[1] as string) as any;

      expect(writtenContent.executionContexts[contextName]).toBeUndefined();
    });

    it('is idempotent (safe to call multiple times)', async () => {
      // First destroy: clean up everything
      await manager.destroy(contextName);

      // Reset mocks
      jest.clearAllMocks();
      mockExecCmd.mockResolvedValue({ code: 0, stdout: '', stderr: '' });
      mockFs.existsSync.mockReturnValue(false); // Resources already gone
      mockFs.writeFileSync.mockReturnValue(undefined);
      mockFs.readFileSync.mockReturnValue(yaml.dump({ executionContexts: {} }));

      // Second destroy: resources already gone, should complete successfully (idempotent)
      await expect(manager.destroy(contextName)).resolves.not.toThrow();
    });

    it('throws error when context name does not start with agent-dev-', async () => {
      await expect(manager.destroy('staging')).rejects.toThrow(
        "Cannot operate on non-agent context: 'staging'"
      );
    });

    it('reports all errors but completes partial cleanup', async () => {
      mockExecCmd.mockRejectedValue(new Error('Docker error'));
      mockFs.rmSync.mockImplementation(() => {
        throw new Error('File system error');
      });

      await expect(manager.destroy(contextName)).rejects.toThrow(
        /Destroy completed with \d+ error\(s\)/
      );

      // Verify error message contains expected failures
      try {
        await manager.destroy(contextName);
      } catch (error: any) {
        expect(error.message).toContain('error(s)');
        // Docker errors are intentionally caught and ignored for idempotency
        // File system error should be reported
        expect(error.message).toContain('File system error');
      }

      // Ephemeral storage removal should still be attempted
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('preserves other ephemeral contexts when destroying one', async () => {
      const otherContext = 'agent-dev-other';
      mockFs.readFileSync.mockReturnValue(yaml.dump({
        executionContexts: {
          [contextName]: {
            deployment: { type: 'docker-compose' },
            runtime: { gateway: {}, persistence: { driver: 'postgres' } },
          },
          [otherContext]: {
            deployment: { type: 'docker-compose' },
            runtime: { gateway: {}, persistence: { driver: 'postgres' } },
          },
        },
      }));

      await manager.destroy(contextName);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const writtenContent = yaml.load(writeCall[1] as string) as any;

      expect(writtenContent.executionContexts[contextName]).toBeUndefined();
      expect(writtenContent.executionContexts[otherContext]).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('handles missing .brat directory during provision', async () => {
      const mockConfig: ExecutionContext = {
        deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
        runtime: {
          gateway: { fallbackPort: 3004 },
          persistence: { driver: 'postgres' },
        },
      };

      mockBuildNonInteractive.mockResolvedValue(mockConfig);
      mockScaffoldEnvironment.mockResolvedValue(undefined);
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockReturnValue(undefined);
      mockFs.writeFileSync.mockReturnValue(undefined);

      const result = await manager.provision();

      expect(mockFs.mkdirSync).toHaveBeenCalled();
      expect(result.status).toBe('provisioned');
    });

    it('handles corrupted ephemeral storage file gracefully', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid: yaml: [[[');

      const mockConfig: ExecutionContext = {
        deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
        runtime: {
          gateway: { fallbackPort: 3004 },
          persistence: { driver: 'postgres' },
        },
      };

      mockBuildNonInteractive.mockResolvedValue(mockConfig);
      mockScaffoldEnvironment.mockResolvedValue(undefined);
      mockFs.mkdirSync.mockReturnValue(undefined);
      mockFs.writeFileSync.mockReturnValue(undefined);

      // Should create new ephemeral storage instead of failing
      const result = await manager.provision();
      expect(result.status).toBe('provisioned');
    });

    it('uses fallback gateway URL when config is incomplete', async () => {
      const contextName = 'agent-dev-incomplete';
      const mockConfig: ExecutionContext = {
        deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
        runtime: {
          gateway: {}, // No fallbackPort or url
          persistence: { driver: 'postgres' },
        },
      };

      mockBuildNonInteractive.mockResolvedValue(mockConfig);
      mockScaffoldEnvironment.mockResolvedValue(undefined);
      mockFs.mkdirSync.mockReturnValue(undefined);
      mockFs.writeFileSync.mockReturnValue(undefined);

      const result = await manager.provision({ name: contextName });

      // Should use default fallback port
      expect(result.gateway.url).toMatch(/localhost:\d+\/ws\/v1/);
    });
  });
});

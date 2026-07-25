/**
 * BratCommand Base Class Tests
 * Sprint 359: Integration tests for oclif base command pattern
 */

import { Command, Flags } from '@oclif/core';
import * as path from 'path';
import { BratCommand } from './base';
import { ContextResolver } from '../context/context-resolver';
import { createLogger } from '../orchestration/logger';

// Mock dependencies
jest.mock('../context/context-resolver');
jest.mock('../orchestration/logger');

const mockContextResolver = ContextResolver as jest.MockedClass<typeof ContextResolver>;
const mockCreateLogger = createLogger as jest.MockedFunction<typeof createLogger>;

// Test command implementation
class TestCommand extends BratCommand {
  static description = 'Test command for BratCommand base class';

  static flags = {
    ...BratCommand.baseFlags,
    testFlag: Flags.string({
      description: 'Test flag',
      default: 'test-value',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(TestCommand);
    this.logger.info({ testFlag: flags.testFlag }, 'Test command executed');
  }
}

describe('BratCommand Base Class', () => {
  let mockLogger: any;
  let mockContext: any;
  let mockResolver: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock logger
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    mockCreateLogger.mockReturnValue(mockLogger as any);

    // Mock context
    mockContext = {
      name: 'local',
      deployment: {
        type: 'docker-compose',
        docker: { host: 'unix:///var/run/docker.sock' },
      },
      runtime: {
        gateway: { fallbackPort: 3000 },
        persistence: { driver: 'postgres', connection: {} },
      },
    };

    // Mock resolver
    mockResolver = {
      resolve: jest.fn().mockResolvedValue(mockContext),
    };
    mockContextResolver.mockImplementation(() => mockResolver);
  });

  describe('Initialization', () => {
    test('should initialize logger with default info level', async () => {
      const cmd = new TestCommand([], {} as any);
      await cmd.init();

      expect(mockCreateLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
          base: { command: 'base:test' },
        })
      );
    });

    test('should initialize logger with debug level when verbose flag is set', async () => {
      const cmd = new TestCommand(['--verbose'], {} as any);
      await cmd.init();

      expect(mockCreateLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'debug',
        })
      );
    });

    test('should calculate repository root correctly', async () => {
      const cmd = new TestCommand([], {} as any);
      await cmd.init();

      // Repository root should be calculated from __dirname
      // In compiled code: dist/tools/brat/src/oclif-commands -> need to go up 5 levels
      const expectedRoot = path.resolve(__dirname, '../../../../..');
      expect(cmd['repoRoot']).toBe(expectedRoot);
    });

    test('should resolve execution context using ContextResolver', async () => {
      const cmd = new TestCommand(['--context', 'staging'], {} as any);
      await cmd.init();

      expect(mockContextResolver).toHaveBeenCalledWith(cmd['repoRoot']);
      expect(mockResolver.resolve).toHaveBeenCalledWith('staging');
      expect(cmd['context']).toBe(mockContext);
    });

    test('should resolve context from BITBRAT_CONTEXT env when flag not provided', async () => {
      process.env.BITBRAT_CONTEXT = 'prod';
      const cmd = new TestCommand([], {} as any);
      await cmd.init();

      expect(mockResolver.resolve).toHaveBeenCalledWith(undefined);
      delete process.env.BITBRAT_CONTEXT;
    });
  });

  describe('Global Flags', () => {
    test('should have --context flag', () => {
      const flags = BratCommand.baseFlags;
      expect(flags).toHaveProperty('context');
      expect(flags.context).toMatchObject({
        char: 'c',
        description: expect.stringContaining('Execution context'),
        env: 'BITBRAT_CONTEXT',
        required: false,
      });
    });

    test('should have --verbose flag', () => {
      const flags = BratCommand.baseFlags;
      expect(flags).toHaveProperty('verbose');
      expect(flags.verbose).toMatchObject({
        char: 'v',
        description: expect.stringContaining('verbose'),
        default: false,
      });
    });
  });

  describe('Dependency Injection', () => {
    test('should support getDeps() for dependency injection', async () => {
      const cmd = new TestCommand([], {} as any);
      await cmd.init();

      const deps = cmd['getDeps']();
      expect(deps).toBeDefined();
    });

    test('should allow overriding dependencies', async () => {
      const cmd = new TestCommand([], {} as any);
      await cmd.init();

      const mockDeps: any = { customDep: 'mock-value' };
      const deps = cmd['getDeps'](mockDeps);

      expect(deps).toMatchObject(mockDeps);
    });

    test('should merge dependency overrides', async () => {
      const cmd = new TestCommand([], {} as any);
      await cmd.init();

      const firstOverride: any = { dep1: 'value1' };
      const secondOverride: any = { dep2: 'value2' };

      cmd['getDeps'](firstOverride);
      const deps = cmd['getDeps'](secondOverride);

      expect(deps).toMatchObject({ dep1: 'value1', dep2: 'value2' });
    });
  });

  describe('Logger Integration', () => {
    test('should expose logger to subclasses', async () => {
      const cmd = new TestCommand([], {} as any);
      await cmd.init();

      expect(cmd['logger']).toBe(mockLogger);
    });

    test('should use logger in command execution', async () => {
      const cmd = new TestCommand([], {} as any);
      await cmd.init();
      await cmd.run();

      expect(mockLogger.info).toHaveBeenCalledWith(
        { testFlag: 'test-value' },
        'Test command executed'
      );
    });
  });

  describe('Context Integration', () => {
    test('should expose context to subclasses', async () => {
      const cmd = new TestCommand(['--context', 'staging'], {} as any);
      await cmd.init();

      expect(cmd['context']).toBe(mockContext);
      expect(cmd['context'].name).toBe('local');
    });

    test('should resolve different contexts', async () => {
      const stagingContext = {
        name: 'staging',
        deployment: { type: 'docker-compose', docker: { host: 'ssh://root@bitbrat.lan' } },
        runtime: { gateway: {}, persistence: { driver: 'postgres' } },
      };

      mockResolver.resolve.mockResolvedValue(stagingContext);

      const cmd = new TestCommand(['--context', 'staging'], {} as any);
      await cmd.init();

      expect(cmd['context']).toBe(stagingContext);
      expect(cmd['context'].name).toBe('staging');
    });
  });

  describe('Inheritance', () => {
    test('should extend oclif Command', () => {
      expect(TestCommand.prototype).toBeInstanceOf(Command);
    });

    test('should inherit baseFlags in subclass', () => {
      const testFlags = TestCommand.flags;
      expect(testFlags).toHaveProperty('context');
      expect(testFlags).toHaveProperty('verbose');
      expect(testFlags).toHaveProperty('testFlag');
    });
  });

  describe('Error Handling', () => {
    test('should handle context resolution errors gracefully', async () => {
      const error = new Error('Context resolution failed');
      mockResolver.resolve.mockRejectedValue(error);

      const cmd = new TestCommand(['--context', 'invalid'], {} as any);

      await expect(cmd.init()).rejects.toThrow('Context resolution failed');
    });
  });

  describe('Repository Root Calculation', () => {
    test('should calculate correct repository root in development', async () => {
      const cmd = new TestCommand([], {} as any);
      await cmd.init();

      // Should be 5 levels up from compiled dist/tools/brat/src/oclif-commands
      const expectedRoot = path.resolve(__dirname, '../../../../..');
      expect(cmd['repoRoot']).toBe(expectedRoot);
    });
  });
});

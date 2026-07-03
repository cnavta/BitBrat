/**
 * Unit tests for brat bit create command logic
 * Sprint 331: BL-331-204
 */

import fs from 'fs';
import path from 'path';
import { cmdBitCreate } from '../create';
import { Logger } from '../../../orchestration/logger';
import * as loader from '../../../config/loader';
import * as validation from '../validation';
import * as templates from '../templates';
import * as registry from '../registry';

// Mock dependencies
jest.mock('fs');
jest.mock('../../../config/loader');
jest.mock('../validation');
jest.mock('../templates');
jest.mock('../registry');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockLoader = loader as jest.Mocked<typeof loader>;
const mockValidation = validation as jest.Mocked<typeof validation>;
const mockTemplates = templates as jest.Mocked<typeof templates>;
const mockRegistry = registry as jest.Mocked<typeof registry>;

// Mock logger
const mockLogger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as any;

// Mock console
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalProcessExit = process.exit;

describe('cmdBitCreate', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock console
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Mock process.exit
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit: ${code}`);
    }) as any;

    // Default mocks for happy path
    mockFs.existsSync.mockReturnValue(false);
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.writeFileSync.mockReturnValue(undefined);

    mockValidation.validateBitName.mockReturnValue({ valid: true, errors: [] });
    mockValidation.validateProfileExposure.mockReturnValue({ valid: true, errors: [] });
    mockValidation.validateBitDoesNotExist.mockReturnValue({ valid: true, errors: [] });

    mockTemplates.generateAppSource.mockReturnValue('// App source');
    mockTemplates.generateTest.mockReturnValue('// Test');
    mockTemplates.generateDockerfile.mockReturnValue('# Dockerfile');
    mockTemplates.generateCompose.mockReturnValue('# Compose');

    mockLoader.loadArchitecture.mockReturnValue({ services: {} });
    mockRegistry.registerBitInArchitecture.mockResolvedValue(undefined);

    // Mock process.cwd()
    jest.spyOn(process, 'cwd').mockReturnValue('/test/project');
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('help display', () => {
    it('should show help when --help flag is provided', async () => {
      const cmd = ['bit', 'create'];
      const rest = ['--help'];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(output).toContain('brat bit create');
      expect(output).toContain('Usage:');
      expect(output).toContain('Examples:');
    });

    it('should show help when -h flag is provided', async () => {
      const cmd = ['bit', 'create'];
      const rest = ['-h'];
      const flags = { h: true };

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(output).toContain('brat bit create');
    });
  });

  describe('argument parsing', () => {
    it('should require a name argument', async () => {
      const cmd = ['bit', 'create'];
      const rest: string[] = [];
      const flags = {};

      await expect(cmdBitCreate(cmd, rest, flags, mockLogger)).rejects.toThrow('process.exit: 2');

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Bit name is required');
    });

    it('should parse name from positional argument', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest: string[] = [];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(mockValidation.validateBitName).toHaveBeenCalledWith('my-service');
      expect(mockTemplates.generateAppSource).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'my-service' })
      );
    });

    it('should parse name from --name flag', async () => {
      const cmd = ['bit', 'create'];
      const rest = ['--name', 'my-service'];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(mockValidation.validateBitName).toHaveBeenCalledWith('my-service');
    });

    it('should use default values for optional parameters', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest: string[] = [];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(mockTemplates.generateAppSource).toHaveBeenCalledWith({
        name: 'my-service',
        profile: 'core',
        exposure: 'platform-only',
        kind: 'pipeline-service',
        port: 3000,
        entry: 'src/apps/my-service-service.ts',
      });
    });

    it('should parse custom profile, exposure, and kind', async () => {
      const cmd = ['bit', 'create', 'api-gateway'];
      const rest = ['--profile', 'gateway', '--exposure', 'platform+domain', '--kind', 'gateway'];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(mockTemplates.generateAppSource).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: 'gateway',
          exposure: 'platform+domain',
          kind: 'gateway',
        })
      );
    });

    it('should parse custom port', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest = ['--port', '8080'];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(mockTemplates.generateAppSource).toHaveBeenCalledWith(
        expect.objectContaining({ port: 8080 })
      );
    });

    it('should parse custom entry point', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest = ['--entry', 'src/custom/my-service.ts'];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(mockTemplates.generateAppSource).toHaveBeenCalledWith(
        expect.objectContaining({ entry: 'src/custom/my-service.ts' })
      );
    });

    it('should parse boolean flags correctly', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest = ['--active', '--force', '--register'];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(mockRegistry.registerBitInArchitecture).toHaveBeenCalledWith(
        expect.objectContaining({ active: true }),
        expect.any(String),
        mockLogger
      );
    });
  });

  describe('validation orchestration', () => {
    it('should validate Bit name', async () => {
      const cmd = ['bit', 'create', 'MyService'];
      const rest: string[] = [];
      const flags = {};

      mockValidation.validateBitName.mockReturnValue({
        valid: false,
        errors: ['Name must be in kebab-case'],
      });

      await expect(cmdBitCreate(cmd, rest, flags, mockLogger)).rejects.toThrow('process.exit: 2');

      expect(consoleErrorSpy).toHaveBeenCalledWith('\n❌ Validation Error:\n');
      expect(consoleErrorSpy).toHaveBeenCalledWith('  Name must be in kebab-case');
    });

    it('should validate profile/exposure combination', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest = ['--profile', 'mcp-domain', '--exposure', 'platform-only'];
      const flags = {};

      mockValidation.validateProfileExposure.mockReturnValue({
        valid: false,
        errors: ['mcp-domain requires platform+domain exposure'],
      });

      await expect(cmdBitCreate(cmd, rest, flags, mockLogger)).rejects.toThrow('process.exit: 2');

      expect(consoleErrorSpy).toHaveBeenCalledWith('\n❌ Validation Error:\n');
      expect(consoleErrorSpy).toHaveBeenCalledWith('  mcp-domain requires platform+domain exposure');
    });

    it('should validate uniqueness when --register is provided', async () => {
      const cmd = ['bit', 'create', 'existing-service'];
      const rest = ['--register'];
      const flags = {};

      mockLoader.loadArchitecture.mockReturnValue({
        services: { 'existing-service': {} },
      });

      mockValidation.validateBitDoesNotExist.mockReturnValue({
        valid: false,
        errors: ['Service already exists in architecture.yaml'],
      });

      await expect(cmdBitCreate(cmd, rest, flags, mockLogger)).rejects.toThrow('process.exit: 2');

      expect(mockLoader.loadArchitecture).toHaveBeenCalledWith('/test/project');
      expect(mockValidation.validateBitDoesNotExist).toHaveBeenCalled();
    });

    it('should skip uniqueness validation when --register is not provided', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest: string[] = [];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(mockLoader.loadArchitecture).not.toHaveBeenCalled();
      expect(mockValidation.validateBitDoesNotExist).not.toHaveBeenCalled();
    });
  });

  describe('file generation', () => {
    it('should generate all required files', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest: string[] = [];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(mockTemplates.generateAppSource).toHaveBeenCalled();
      expect(mockTemplates.generateTest).toHaveBeenCalled();
      expect(mockTemplates.generateDockerfile).toHaveBeenCalled();
      expect(mockTemplates.generateCompose).toHaveBeenCalled();
    });

    it('should write app source to correct path', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest: string[] = [];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/test/project/src/apps/my-service-service.ts',
        '// App source',
        'utf8'
      );
    });

    it('should write test file alongside app source', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest: string[] = [];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/test/project/src/apps/my-service-service.test.ts',
        '// Test',
        'utf8'
      );
    });

    it('should write Dockerfile to root', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest: string[] = [];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/test/project/Dockerfile.my-service',
        '# Dockerfile',
        'utf8'
      );
    });

    it('should write docker-compose to services directory', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest: string[] = [];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/test/project/infrastructure/docker-compose/services/my-service.compose.yaml',
        '# Compose',
        'utf8'
      );
    });

    it('should create directories recursively', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest: string[] = [];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/test/project/src/apps', { recursive: true });
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        '/test/project/infrastructure/docker-compose/services',
        { recursive: true }
      );
    });

    it('should skip existing files when force is false', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest: string[] = [];
      const flags = {};

      mockFs.existsSync.mockReturnValue(true);

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();

      const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(output).toContain('[EXISTS, SKIPPED]');
    });

    it('should overwrite existing files when force is true', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest = ['--force'];
      const flags = {};

      mockFs.existsSync.mockReturnValue(true);

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(mockFs.writeFileSync).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();

      const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(output).toContain('[CREATED]');
    });
  });

  describe('registration', () => {
    it('should register in architecture.yaml when --register is provided', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest = ['--register', '--active'];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(mockRegistry.registerBitInArchitecture).toHaveBeenCalledWith(
        {
          name: 'my-service',
          profile: 'core',
          exposure: 'platform-only',
          kind: 'pipeline-service',
          entry: 'src/apps/my-service-service.ts',
          port: 3000,
          description: 'Generated Bit: my-service',
          active: true,
          stage: undefined,
        },
        '/test/project',
        mockLogger
      );
    });

    it('should skip registration when --register is not provided', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest: string[] = [];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(mockRegistry.registerBitInArchitecture).not.toHaveBeenCalled();
    });

    it('should include stage in registration options when provided', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest = ['--register', '--stage', 'ingest'];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(mockRegistry.registerBitInArchitecture).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'ingest' }),
        expect.any(String),
        mockLogger
      );
    });

    it('should handle registration errors gracefully', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest = ['--register'];
      const flags = {};

      mockRegistry.registerBitInArchitecture.mockRejectedValue(
        new Error('Service already exists in architecture.yaml')
      );

      await expect(cmdBitCreate(cmd, rest, flags, mockLogger)).rejects.toThrow('process.exit: 1');

      expect(consoleErrorSpy).toHaveBeenCalledWith('\n❌ Registration Error:\n');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '  Service already exists in architecture.yaml'
      );
    });
  });

  describe('output and summary', () => {
    it('should print success message', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest: string[] = [];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(output).toContain('✅ Bit creation complete');
    });

    it('should show next steps without registration', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest: string[] = [];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(output).toContain('Next steps:');
      expect(output).toContain('npm run build');
      expect(output).toContain('npm test');
      expect(output).toContain('Register in architecture.yaml');
    });

    it('should show next steps with registration', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest = ['--register'];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(output).toContain('[REGISTERED] architecture.yaml');
      expect(output).not.toContain('Register in architecture.yaml');
    });

    it('should show created file paths', async () => {
      const cmd = ['bit', 'create', 'my-service'];
      const rest: string[] = [];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(output).toContain('App source');
      expect(output).toContain('Test');
      expect(output).toContain('Dockerfile');
      expect(output).toContain('Docker Compose');
    });
  });

  describe('complex scenarios', () => {
    it('should handle gateway with platform+domain exposure', async () => {
      const cmd = ['bit', 'create', 'api-gateway'];
      const rest = [
        '--profile',
        'gateway',
        '--exposure',
        'platform+domain',
        '--kind',
        'gateway',
        '--port',
        '8080',
        '--register',
        '--active',
      ];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(mockValidation.validateProfileExposure).toHaveBeenCalledWith(
        'gateway',
        'platform+domain'
      );
      expect(mockTemplates.generateAppSource).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'api-gateway',
          profile: 'gateway',
          exposure: 'platform+domain',
          kind: 'gateway',
          port: 8080,
        })
      );
      expect(mockRegistry.registerBitInArchitecture).toHaveBeenCalled();
    });

    it('should handle mcp-domain Bit', async () => {
      const cmd = ['bit', 'create', 'custom-tools'];
      const rest = [
        '--profile',
        'mcp-domain',
        '--exposure',
        'platform+domain',
        '--kind',
        'mcp-server',
        '--register',
      ];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(mockTemplates.generateAppSource).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: 'mcp-domain',
          exposure: 'platform+domain',
          kind: 'mcp-server',
        })
      );
    });

    it('should handle llm Bit with custom description', async () => {
      const cmd = ['bit', 'create', 'llm-service'];
      const rest = [
        '--profile',
        'llm',
        '--description',
        'LLM orchestration service',
        '--port',
        '3001',
      ];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      expect(mockTemplates.generateAppSource).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: 'llm',
          name: 'llm-service',
        })
      );
    });
  });
});

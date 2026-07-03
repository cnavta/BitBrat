/**
 * Unit tests for architecture.yaml registration
 * Sprint 331: BL-331-203
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { registerBitInArchitecture, RegistrationOptions } from '../registry';
import { Logger } from '../../../orchestration/logger';

// Mock fs module
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock logger
const mockLogger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as any;

describe('registerBitInArchitecture', () => {
  const rootPath = '/test/root';
  const archPath = '/test/root/architecture.yaml';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('successful registration', () => {
    it('should register a new Bit with all required fields', async () => {
      const existingArch = {
        services: {
          'existing-service': {
            profile: 'core',
            mcp: { exposure: 'platform-only' },
            active: true,
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(yaml.dump(existingArch));

      const opts: RegistrationOptions = {
        name: 'new-service',
        profile: 'core',
        exposure: 'platform-only',
        kind: 'pipeline-service',
        entry: 'src/apps/new-service.ts',
        port: 3000,
        description: 'Test service',
        active: true,
      };

      await registerBitInArchitecture(opts, rootPath, mockLogger);

      expect(mockFs.existsSync).toHaveBeenCalledWith(archPath);
      expect(mockFs.readFileSync).toHaveBeenCalledWith(archPath, 'utf8');
      expect(mockFs.writeFileSync).toHaveBeenCalled();

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      expect(writeCall[0]).toBe(archPath);

      const writtenContent = writeCall[1] as string;
      const writtenArch = yaml.load(writtenContent) as any;

      expect(writtenArch.services['new-service']).toEqual({
        profile: 'core',
        mcp: { exposure: 'platform-only' },
        active: true,
        description: 'Test service',
        kind: 'pipeline-service',
        entry: 'src/apps/new-service.ts',
        port: 3000,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        { name: 'new-service', profile: 'core', exposure: 'platform-only' },
        'Registered Bit in architecture.yaml'
      );
    });

    it('should include optional stage field when provided', async () => {
      const existingArch = { services: {} };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(yaml.dump(existingArch));

      const opts: RegistrationOptions = {
        name: 'staged-service',
        profile: 'gateway',
        exposure: 'platform+domain',
        kind: 'gateway',
        entry: 'src/apps/staged-service.ts',
        port: 8080,
        description: 'Staged service',
        active: true,
        stage: 'beta',
      };

      await registerBitInArchitecture(opts, rootPath, mockLogger);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const writtenContent = writeCall[1] as string;
      const writtenArch = yaml.load(writtenContent) as any;

      expect(writtenArch.services['staged-service'].stage).toBe('beta');
    });

    it('should not include stage field when not provided', async () => {
      const existingArch = { services: {} };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(yaml.dump(existingArch));

      const opts: RegistrationOptions = {
        name: 'no-stage-service',
        profile: 'core',
        exposure: 'none',
        kind: 'pipeline-service',
        entry: 'src/apps/no-stage-service.ts',
        port: 3001,
        description: 'No stage',
        active: false,
      };

      await registerBitInArchitecture(opts, rootPath, mockLogger);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const writtenContent = writeCall[1] as string;
      const writtenArch = yaml.load(writtenContent) as any;

      expect(writtenArch.services['no-stage-service'].stage).toBeUndefined();
    });

    it('should create services object if missing', async () => {
      const existingArch = {
        platform: 'bitbrat',
        version: '1.0.0',
        // No services object
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(yaml.dump(existingArch));

      const opts: RegistrationOptions = {
        name: 'first-service',
        profile: 'core',
        exposure: 'platform-only',
        kind: 'pipeline-service',
        entry: 'src/apps/first-service.ts',
        port: 3000,
        description: 'First service',
        active: true,
      };

      await registerBitInArchitecture(opts, rootPath, mockLogger);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const writtenContent = writeCall[1] as string;
      const writtenArch = yaml.load(writtenContent) as any;

      expect(writtenArch.services).toBeDefined();
      expect(writtenArch.services['first-service']).toBeDefined();
    });

    it('should preserve existing services when adding new one', async () => {
      const existingArch = {
        services: {
          'service-1': {
            profile: 'core',
            mcp: { exposure: 'platform-only' },
            active: true,
          },
          'service-2': {
            profile: 'gateway',
            mcp: { exposure: 'platform+domain' },
            active: true,
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(yaml.dump(existingArch));

      const opts: RegistrationOptions = {
        name: 'service-3',
        profile: 'llm',
        exposure: 'platform-only',
        kind: 'pipeline-service',
        entry: 'src/apps/service-3.ts',
        port: 3002,
        description: 'Service 3',
        active: true,
      };

      await registerBitInArchitecture(opts, rootPath, mockLogger);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const writtenContent = writeCall[1] as string;
      const writtenArch = yaml.load(writtenContent) as any;

      expect(Object.keys(writtenArch.services)).toHaveLength(3);
      expect(writtenArch.services['service-1']).toBeDefined();
      expect(writtenArch.services['service-2']).toBeDefined();
      expect(writtenArch.services['service-3']).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should throw error if architecture.yaml does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const opts: RegistrationOptions = {
        name: 'test-service',
        profile: 'core',
        exposure: 'platform-only',
        kind: 'pipeline-service',
        entry: 'src/apps/test-service.ts',
        port: 3000,
        description: 'Test',
        active: true,
      };

      await expect(registerBitInArchitecture(opts, rootPath, mockLogger)).rejects.toThrow(
        'architecture.yaml not found at /test/root/architecture.yaml'
      );
    });

    it('should throw error if architecture.yaml contains invalid YAML', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid: yaml: content: [[[');

      const opts: RegistrationOptions = {
        name: 'test-service',
        profile: 'core',
        exposure: 'platform-only',
        kind: 'pipeline-service',
        entry: 'src/apps/test-service.ts',
        port: 3000,
        description: 'Test',
        active: true,
      };

      await expect(registerBitInArchitecture(opts, rootPath, mockLogger)).rejects.toThrow();
    });

    it('should throw error if YAML does not parse to object', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('just a string');

      const opts: RegistrationOptions = {
        name: 'test-service',
        profile: 'core',
        exposure: 'platform-only',
        kind: 'pipeline-service',
        entry: 'src/apps/test-service.ts',
        port: 3000,
        description: 'Test',
        active: true,
      };

      await expect(registerBitInArchitecture(opts, rootPath, mockLogger)).rejects.toThrow(
        'Invalid architecture.yaml: could not parse as object'
      );
    });

    it('should throw error if YAML is null', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('null');

      const opts: RegistrationOptions = {
        name: 'test-service',
        profile: 'core',
        exposure: 'platform-only',
        kind: 'pipeline-service',
        entry: 'src/apps/test-service.ts',
        port: 3000,
        description: 'Test',
        active: true,
      };

      await expect(registerBitInArchitecture(opts, rootPath, mockLogger)).rejects.toThrow(
        'Invalid architecture.yaml: could not parse as object'
      );
    });

    it('should throw error if service already exists', async () => {
      const existingArch = {
        services: {
          'existing-service': {
            profile: 'core',
            mcp: { exposure: 'platform-only' },
            active: true,
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(yaml.dump(existingArch));

      const opts: RegistrationOptions = {
        name: 'existing-service',
        profile: 'gateway',
        exposure: 'platform+domain',
        kind: 'gateway',
        entry: 'src/apps/existing-service.ts',
        port: 8080,
        description: 'Duplicate',
        active: true,
      };

      await expect(registerBitInArchitecture(opts, rootPath, mockLogger)).rejects.toThrow(
        "Service 'existing-service' already exists in architecture.yaml"
      );
    });

    it('should provide helpful error message for duplicate with --force hint', async () => {
      const existingArch = {
        services: {
          'my-service': {},
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(yaml.dump(existingArch));

      const opts: RegistrationOptions = {
        name: 'my-service',
        profile: 'core',
        exposure: 'platform-only',
        kind: 'pipeline-service',
        entry: 'src/apps/my-service.ts',
        port: 3000,
        description: 'Test',
        active: true,
      };

      await expect(registerBitInArchitecture(opts, rootPath, mockLogger)).rejects.toThrow(
        'Use --force to overwrite files, but manual removal from architecture.yaml is required'
      );
    });
  });

  describe('YAML formatting', () => {
    it('should use correct YAML dump options', async () => {
      const existingArch = { services: {} };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(yaml.dump(existingArch));

      const dumpSpy = jest.spyOn(yaml, 'dump');

      const opts: RegistrationOptions = {
        name: 'test-service',
        profile: 'core',
        exposure: 'platform-only',
        kind: 'pipeline-service',
        entry: 'src/apps/test-service.ts',
        port: 3000,
        description: 'Test',
        active: true,
      };

      await registerBitInArchitecture(opts, rootPath, mockLogger);

      expect(dumpSpy).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          indent: 2,
          lineWidth: 120,
          noRefs: true,
          sortKeys: false,
        })
      );

      dumpSpy.mockRestore();
    });

    it('should write content with utf8 encoding', async () => {
      const existingArch = { services: {} };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(yaml.dump(existingArch));

      const opts: RegistrationOptions = {
        name: 'test-service',
        profile: 'core',
        exposure: 'platform-only',
        kind: 'pipeline-service',
        entry: 'src/apps/test-service.ts',
        port: 3000,
        description: 'Test',
        active: true,
      };

      await registerBitInArchitecture(opts, rootPath, mockLogger);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      expect(writeCall[2]).toBe('utf8');
    });
  });

  describe('different profile types', () => {
    it('should register gateway Bit with platform+domain exposure', async () => {
      const existingArch = { services: {} };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(yaml.dump(existingArch));

      const opts: RegistrationOptions = {
        name: 'api-gateway',
        profile: 'gateway',
        exposure: 'platform+domain',
        kind: 'gateway',
        entry: 'src/apps/api-gateway.ts',
        port: 8080,
        description: 'API Gateway',
        active: true,
      };

      await registerBitInArchitecture(opts, rootPath, mockLogger);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const writtenContent = writeCall[1] as string;
      const writtenArch = yaml.load(writtenContent) as any;

      expect(writtenArch.services['api-gateway']).toMatchObject({
        profile: 'gateway',
        mcp: { exposure: 'platform+domain' },
        kind: 'gateway',
      });
    });

    it('should register mcp-domain Bit with platform+domain exposure', async () => {
      const existingArch = { services: {} };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(yaml.dump(existingArch));

      const opts: RegistrationOptions = {
        name: 'custom-tools',
        profile: 'mcp-domain',
        exposure: 'platform+domain',
        kind: 'mcp-server',
        entry: 'src/apps/custom-tools.ts',
        port: 3003,
        description: 'Custom MCP Tools',
        active: true,
      };

      await registerBitInArchitecture(opts, rootPath, mockLogger);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const writtenContent = writeCall[1] as string;
      const writtenArch = yaml.load(writtenContent) as any;

      expect(writtenArch.services['custom-tools']).toMatchObject({
        profile: 'mcp-domain',
        mcp: { exposure: 'platform+domain' },
        kind: 'mcp-server',
      });
    });

    it('should register llm Bit with platform-only exposure', async () => {
      const existingArch = { services: {} };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(yaml.dump(existingArch));

      const opts: RegistrationOptions = {
        name: 'llm-service',
        profile: 'llm',
        exposure: 'platform-only',
        kind: 'pipeline-service',
        entry: 'src/apps/llm-service.ts',
        port: 3004,
        description: 'LLM Service',
        active: true,
      };

      await registerBitInArchitecture(opts, rootPath, mockLogger);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const writtenContent = writeCall[1] as string;
      const writtenArch = yaml.load(writtenContent) as any;

      expect(writtenArch.services['llm-service']).toMatchObject({
        profile: 'llm',
        mcp: { exposure: 'platform-only' },
        kind: 'pipeline-service',
      });
    });

    it('should register core Bit with none exposure', async () => {
      const existingArch = { services: {} };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(yaml.dump(existingArch));

      const opts: RegistrationOptions = {
        name: 'internal-service',
        profile: 'core',
        exposure: 'none',
        kind: 'pipeline-service',
        entry: 'src/apps/internal-service.ts',
        port: 3005,
        description: 'Internal Service',
        active: false,
      };

      await registerBitInArchitecture(opts, rootPath, mockLogger);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const writtenContent = writeCall[1] as string;
      const writtenArch = yaml.load(writtenContent) as any;

      expect(writtenArch.services['internal-service']).toMatchObject({
        profile: 'core',
        mcp: { exposure: 'none' },
        active: false,
      });
    });
  });
});

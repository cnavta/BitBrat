/**
 * Integration test for brat bit create
 * Tests end-to-end flow with real file system operations
 * Sprint 331: BL-331-205
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { cmdBitCreate } from '../create';
import { Logger } from '../../../orchestration/logger';

// Mock only the logger to avoid console noise
const mockLogger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as any;

// Mock console to suppress output during tests
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

describe('brat bit create - Integration', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    (console.log as jest.Mock).mockRestore();
    (console.error as jest.Mock).mockRestore();
  });

  beforeEach(() => {
    // Create temp directory for test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brat-test-'));

    // Save original cwd
    originalCwd = process.cwd();

    // Change to temp directory
    process.chdir(tempDir);

    // Create minimal architecture.yaml
    const minimalArch = {
      platform: 'bitbrat',
      version: '0.7.3',
      services: {},
    };
    fs.writeFileSync(path.join(tempDir, 'architecture.yaml'), yaml.dump(minimalArch), 'utf8');
  });

  afterEach(() => {
    // Restore original cwd
    process.chdir(originalCwd);

    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('successful Bit creation', () => {
    it('should create all files for a basic core Bit', async () => {
      const cmd = ['bit', 'create', 'test-service'];
      const rest: string[] = [];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      // Verify app source was created
      const appPath = path.join(tempDir, 'src/apps/test-service-service.ts');
      expect(fs.existsSync(appPath)).toBe(true);

      const appSource = fs.readFileSync(appPath, 'utf8');
      expect(appSource).toContain('class TestServiceServer extends Bit');
      expect(appSource).toContain('platform-only');

      // Verify test was created
      const testPath = path.join(tempDir, 'src/apps/test-service-service.test.ts');
      expect(fs.existsSync(testPath)).toBe(true);

      const testSource = fs.readFileSync(testPath, 'utf8');
      expect(testSource).toContain('describe(\'test-service\'');
      expect(testSource).toContain('import { TestServiceServer }');

      // Verify Dockerfile was created
      const dockerfilePath = path.join(tempDir, 'Dockerfile.test-service');
      expect(fs.existsSync(dockerfilePath)).toBe(true);

      const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
      expect(dockerfile).toContain('FROM node:24-slim');
      expect(dockerfile).toContain('CMD ["node", "dist/apps/test-service-service.js"]');

      // Verify docker-compose was created
      const composePath = path.join(
        tempDir,
        'infrastructure/docker-compose/services/test-service.compose.yaml'
      );
      expect(fs.existsSync(composePath)).toBe(true);

      const compose = fs.readFileSync(composePath, 'utf8');
      expect(compose).toContain('test-service:');
      expect(compose).toContain('Dockerfile.test-service');
    });

    it('should create gateway Bit with correct profile', async () => {
      const cmd = ['bit', 'create', 'api-gateway'];
      const rest = ['--profile', 'gateway', '--exposure', 'platform+domain', '--kind', 'gateway'];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      const appPath = path.join(tempDir, 'src/apps/api-gateway-service.ts');
      const appSource = fs.readFileSync(appPath, 'utf8');

      expect(appSource).toContain('class ApiGatewayServer extends Bit');
      expect(appSource).toContain('platform+domain');
      expect(appSource).toContain('setupRoutes()');
      expect(appSource).toContain("import { Request, Response } from 'express'");
    });

    it('should create mcp-server Bit with registerTool example', async () => {
      const cmd = ['bit', 'create', 'custom-tools'];
      const rest = ['--profile', 'mcp-server', '--exposure', 'platform+domain', '--kind', 'mcp-server'];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      const appPath = path.join(tempDir, 'src/apps/custom-tools-service.ts');
      const appSource = fs.readFileSync(appPath, 'utf8');

      expect(appSource).toContain('registerDomainTools()');
      expect(appSource).toContain('this.registerTool(');
      expect(appSource).toContain("import { z } from 'zod'");
    });

    it('should create llm Bit with provider setup', async () => {
      const cmd = ['bit', 'create', 'llm-service'];
      const rest = ['--profile', 'llm'];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      const appPath = path.join(tempDir, 'src/apps/llm-service-service.ts');
      const appSource = fs.readFileSync(appPath, 'utf8');

      expect(appSource).toContain('setupLLM()');
      expect(appSource).toContain('TODO: Initialize LLM provider');
    });
  });

  describe('registration in architecture.yaml', () => {
    it('should register Bit when --register flag is provided', async () => {
      const cmd = ['bit', 'create', 'new-service'];
      const rest = ['--register', '--active'];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      // Load and verify architecture.yaml
      const archPath = path.join(tempDir, 'architecture.yaml');
      const archContent = fs.readFileSync(archPath, 'utf8');
      const arch: any = yaml.load(archContent);

      expect(arch.services['new-service']).toBeDefined();
      expect(arch.services['new-service']).toMatchObject({
        profile: 'core',
        mcp: { exposure: 'platform-only' },
        active: true,
        kind: 'pipeline-service',
        entry: 'src/apps/new-service-service.ts',
        port: 3000,
      });
    });

    it('should not register Bit when --register flag is omitted', async () => {
      const cmd = ['bit', 'create', 'unregistered-service'];
      const rest: string[] = [];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      // Verify architecture.yaml was not modified
      const archPath = path.join(tempDir, 'architecture.yaml');
      const archContent = fs.readFileSync(archPath, 'utf8');
      const arch: any = yaml.load(archContent);

      expect(arch.services['unregistered-service']).toBeUndefined();
    });

    it('should include optional stage in registration', async () => {
      const cmd = ['bit', 'create', 'staged-service'];
      const rest = ['--register', '--stage', 'ingest'];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      const archPath = path.join(tempDir, 'architecture.yaml');
      const archContent = fs.readFileSync(archPath, 'utf8');
      const arch: any = yaml.load(archContent);

      expect(arch.services['staged-service'].stage).toBe('ingest');
    });
  });

  describe('file overwrite behavior', () => {
    it('should skip existing files when --force is not provided', async () => {
      const cmd = ['bit', 'create', 'test-service'];
      const rest: string[] = [];
      const flags = {};

      // Create initial file
      await cmdBitCreate(cmd, rest, flags, mockLogger);

      const appPath = path.join(tempDir, 'src/apps/test-service-service.ts');
      const originalContent = fs.readFileSync(appPath, 'utf8');

      // Modify file
      fs.writeFileSync(appPath, '// Modified content\n' + originalContent, 'utf8');

      // Run command again without --force
      await cmdBitCreate(cmd, rest, flags, mockLogger);

      // Verify file was not overwritten
      const currentContent = fs.readFileSync(appPath, 'utf8');
      expect(currentContent).toContain('// Modified content');
    });

    it('should overwrite existing files when --force is provided', async () => {
      const cmd = ['bit', 'create', 'test-service'];
      const rest: string[] = [];
      const flags = {};

      // Create initial file
      await cmdBitCreate(cmd, rest, flags, mockLogger);

      const appPath = path.join(tempDir, 'src/apps/test-service-service.ts');
      const originalContent = fs.readFileSync(appPath, 'utf8');

      // Modify file
      fs.writeFileSync(appPath, '// Modified content\n', 'utf8');

      // Run command again with --force
      const restWithForce = ['--force'];
      await cmdBitCreate(cmd, restWithForce, flags, mockLogger);

      // Verify file was overwritten
      const currentContent = fs.readFileSync(appPath, 'utf8');
      expect(currentContent).not.toContain('// Modified content');
      expect(currentContent).toContain('class TestServiceServer extends Bit');
    });
  });

  describe('custom configuration', () => {
    it('should respect custom port configuration', async () => {
      const cmd = ['bit', 'create', 'custom-port-service'];
      const rest = ['--port', '8080'];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      const composePath = path.join(
        tempDir,
        'infrastructure/docker-compose/services/custom-port-service.compose.yaml'
      );
      const compose = fs.readFileSync(composePath, 'utf8');

      expect(compose).toContain('"${CUSTOM_PORT_SERVICE_HOST_PORT:-8080}:8080"');
      expect(compose).toContain('PORT=8080');
    });

    it('should respect custom entry point', async () => {
      const cmd = ['bit', 'create', 'custom-entry'];
      const rest = ['--entry', 'src/custom/path/entry.ts'];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      const appPath = path.join(tempDir, 'src/custom/path/entry.ts');
      expect(fs.existsSync(appPath)).toBe(true);

      const testPath = path.join(tempDir, 'src/custom/path/entry.test.ts');
      expect(fs.existsSync(testPath)).toBe(true);

      const dockerfilePath = path.join(tempDir, 'Dockerfile.custom-entry');
      const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
      expect(dockerfile).toContain('CMD ["node", "dist/custom/path/entry.js"]');
    });

    it('should respect custom description in registration', async () => {
      const cmd = ['bit', 'create', 'described-service'];
      const rest = ['--register', '--description', 'My custom service description'];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      const archPath = path.join(tempDir, 'architecture.yaml');
      const archContent = fs.readFileSync(archPath, 'utf8');
      const arch: any = yaml.load(archContent);

      expect(arch.services['described-service'].description).toBe('My custom service description');
    });
  });

  describe('error handling', () => {
    it('should fail when trying to register duplicate service', async () => {
      const cmd = ['bit', 'create', 'duplicate-service'];
      const rest = ['--register'];
      const flags = {};

      // Create first service
      await cmdBitCreate(cmd, rest, flags, mockLogger);

      // Try to create again with --register
      const processExitSpy = jest.spyOn(process, 'exit').mockImplementation((code?: any) => {
        throw new Error(`process.exit: ${code}`);
      });

      await expect(cmdBitCreate(cmd, rest, flags, mockLogger)).rejects.toThrow('process.exit: 2');

      processExitSpy.mockRestore();
    });
  });

  describe('directory creation', () => {
    it('should create nested directories as needed', async () => {
      const cmd = ['bit', 'create', 'deep-service'];
      const rest = ['--entry', 'src/very/deep/nested/path/service.ts'];
      const flags = {};

      await cmdBitCreate(cmd, rest, flags, mockLogger);

      const appPath = path.join(tempDir, 'src/very/deep/nested/path/service.ts');
      expect(fs.existsSync(appPath)).toBe(true);

      const composePath = path.join(
        tempDir,
        'infrastructure/docker-compose/services/deep-service.compose.yaml'
      );
      expect(fs.existsSync(composePath)).toBe(true);
    });
  });
});

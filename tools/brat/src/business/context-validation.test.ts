/**
 * Context Validation Module Unit Tests
 * Sprint 360: Test suite for business/context-validation.ts
 */

import {
  validateContext,
  formatValidationResult,
  ValidationResult,
  ValidationOptions,
} from './context-validation';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

// Mock fs and yaml modules
jest.mock('fs');
jest.mock('js-yaml');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockYaml = yaml as jest.Mocked<typeof yaml>;

describe('Context Validation Business Logic', () => {
  const repoRoot = '/test/repo';
  const contextName = 'test-context';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateContext', () => {
    describe('Perfect Configuration (All Checks Pass)', () => {
      beforeEach(() => {
        // Mock all files exist
        mockFs.existsSync.mockReturnValue(true);

        // Mock global.yaml content
        mockFs.readFileSync.mockImplementation((path: any) => {
          if (path.includes('global.yaml')) {
            return `
BUS_PREFIX: "${contextName}."
PERSISTENCE_DRIVER: postgres
MESSAGE_BUS_DRIVER: nats
DATABASE_URL: "postgresql://user:pass@localhost:5432/db"
`;
          }
          if (path.includes('.secure')) {
            return `
POSTGRES_PASSWORD=secret123
MCP_AUTH_TOKEN=token123
`;
          }
          return '';
        });

        mockYaml.load.mockReturnValue({
          BUS_PREFIX: `${contextName}.`,
          PERSISTENCE_DRIVER: 'postgres',
          MESSAGE_BUS_DRIVER: 'nats',
          DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        });
      });

      it('should pass validation with perfect config', async () => {
        const options: ValidationOptions = {
          repoRoot,
          contextName,
          context: {},
        };

        const result = await validateContext(options);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.warnings).toHaveLength(0);
      });

      it('should log success messages when verbose=true', async () => {
        const logger = jest.fn();
        const options: ValidationOptions = {
          repoRoot,
          contextName,
          context: {},
          verbose: true,
          logger,
        };

        await validateContext(options);

        expect(logger).toHaveBeenCalledWith(expect.stringContaining('✓'));
        expect(logger).toHaveBeenCalledWith(expect.stringContaining('BUS_PREFIX'));
      });
    });

    describe('Error Cases', () => {
      it('should detect missing .secure file', async () => {
        mockFs.existsSync.mockImplementation((path: any) => {
          return !path.includes('.secure');
        });

        const result = await validateContext({
          repoRoot,
          contextName,
          context: {},
        });

        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({
          check: 'secure-file',
          message: expect.stringContaining('.secure.test-context'),
        });
      });

      it('should detect missing env directory', async () => {
        mockFs.existsSync.mockImplementation((path: any) => {
          return !path.includes('env/test-context');
        });

        const result = await validateContext({
          repoRoot,
          contextName,
          context: {},
        });

        expect(result.valid).toBe(false);
        const envDirError = result.errors.find(e => e.check === 'env-directory');
        expect(envDirError).toBeDefined();
        expect(envDirError?.message).toContain('env/test-context');
      });

      it('should detect missing global.yaml', async () => {
        mockFs.existsSync.mockImplementation((path: any) => {
          return !path.includes('global.yaml');
        });

        const result = await validateContext({
          repoRoot,
          contextName,
          context: {},
        });

        expect(result.valid).toBe(false);
        const globalYamlError = result.errors.find(e => e.check === 'global-yaml');
        expect(globalYamlError).toBeDefined();
      });

      it('should detect missing BUS_PREFIX', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue('PERSISTENCE_DRIVER: postgres');
        mockYaml.load.mockReturnValue({
          PERSISTENCE_DRIVER: 'postgres',
        });

        const result = await validateContext({
          repoRoot,
          contextName,
          context: {},
        });

        expect(result.valid).toBe(false);
        const busPrefixError = result.errors.find(e => e.check === 'bus-prefix');
        expect(busPrefixError).toBeDefined();
        expect(busPrefixError?.fix).toContain(`BUS_PREFIX: "${contextName}."`);
      });

      it('should detect missing .env.brat files', async () => {
        mockFs.existsSync.mockImplementation((path: any) => {
          return !path.includes('.env.brat');
        });

        const result = await validateContext({
          repoRoot,
          contextName,
          context: {},
        });

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.check === 'env-brat-root')).toBe(true);
        expect(result.errors.some(e => e.check === 'env-brat-compose')).toBe(true);
        expect(result.errors.some(e => e.check === 'env-brat-services')).toBe(true);
      });

      it('should detect missing required secrets', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockImplementation((path: any) => {
          if (path.includes('.secure')) {
            return 'SOME_OTHER_SECRET=value';
          }
          return 'PERSISTENCE_DRIVER: postgres';
        });
        mockYaml.load.mockReturnValue({
          PERSISTENCE_DRIVER: 'postgres',
          BUS_PREFIX: `${contextName}.`,
        });

        const result = await validateContext({
          repoRoot,
          contextName,
          context: {},
        });

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.check === 'secret-postgres-password')).toBe(true);
        expect(result.errors.some(e => e.check === 'secret-mcp-auth-token')).toBe(true);
      });

      it('should detect incomplete PostgreSQL configuration', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(`
BUS_PREFIX: "${contextName}."
PERSISTENCE_DRIVER: postgres
`);
        mockYaml.load.mockReturnValue({
          BUS_PREFIX: `${contextName}.`,
          PERSISTENCE_DRIVER: 'postgres',
          // Missing DATABASE_URL and POSTGRES_HOST/POSTGRES_DB
        });

        const result = await validateContext({
          repoRoot,
          contextName,
          context: {},
        });

        expect(result.valid).toBe(false);
        const pgError = result.errors.find(e => e.check === 'postgres-config');
        expect(pgError).toBeDefined();
        expect(pgError?.message).toContain('PostgreSQL configuration incomplete');
      });
    });

    describe('Warning Cases', () => {
      beforeEach(() => {
        // Setup base valid configuration
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockImplementation((path: any) => {
          if (path.includes('.secure')) {
            return 'POSTGRES_PASSWORD=secret\nMCP_AUTH_TOKEN=token';
          }
          return '';
        });
      });

      it('should warn about BUS_PREFIX mismatch', async () => {
        mockYaml.load.mockReturnValue({
          BUS_PREFIX: 'wrong-prefix.',
          PERSISTENCE_DRIVER: 'postgres',
          MESSAGE_BUS_DRIVER: 'nats',
          DATABASE_URL: 'postgresql://...',
        });

        const result = await validateContext({
          repoRoot,
          contextName,
          context: {},
        });

        expect(result.valid).toBe(true); // Warnings don't fail validation
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toMatchObject({
          check: 'bus-prefix-mismatch',
          message: expect.stringContaining('wrong-prefix.'),
        });
      });

      it('should warn about missing PERSISTENCE_DRIVER', async () => {
        mockYaml.load.mockReturnValue({
          BUS_PREFIX: `${contextName}.`,
          // Missing PERSISTENCE_DRIVER
        });

        const result = await validateContext({
          repoRoot,
          contextName,
          context: {},
        });

        expect(result.valid).toBe(true);
        const warning = result.warnings.find(w => w.check === 'persistence-driver');
        expect(warning).toBeDefined();
        expect(warning?.recommendation).toContain('postgres');
      });

      it('should warn about deprecated Firestore backend', async () => {
        mockYaml.load.mockReturnValue({
          BUS_PREFIX: `${contextName}.`,
          PERSISTENCE_DRIVER: 'firestore',
        });

        const result = await validateContext({
          repoRoot,
          contextName,
          context: {},
        });

        expect(result.valid).toBe(true);
        const warning = result.warnings.find(w => w.check === 'firestore-deprecated');
        expect(warning).toBeDefined();
        expect(warning?.message).toContain('deprecated Firestore');
        expect(warning?.recommendation).toContain('PostgreSQL');
      });

      it('should warn about missing MESSAGE_BUS_DRIVER', async () => {
        mockYaml.load.mockReturnValue({
          BUS_PREFIX: `${contextName}.`,
          PERSISTENCE_DRIVER: 'postgres',
          DATABASE_URL: 'postgresql://...',
        });

        const result = await validateContext({
          repoRoot,
          contextName,
          context: {},
        });

        expect(result.valid).toBe(true);
        const warning = result.warnings.find(w => w.check === 'message-bus-driver');
        expect(warning).toBeDefined();
        expect(warning?.recommendation).toContain('nats');
      });
    });

    describe('Complex Scenarios', () => {
      it('should handle multiple errors and warnings', async () => {
        mockFs.existsSync.mockReturnValue(false);

        const result = await validateContext({
          repoRoot,
          contextName,
          context: {},
        });

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(3);
      });

      it('should validate PostgreSQL configuration with POSTGRES_* vars', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockImplementation((path: any) => {
          if (path.includes('.secure')) {
            return 'POSTGRES_PASSWORD=secret\nMCP_AUTH_TOKEN=token';
          }
          return '';
        });
        mockYaml.load.mockReturnValue({
          BUS_PREFIX: `${contextName}.`,
          PERSISTENCE_DRIVER: 'postgres',
          POSTGRES_HOST: 'localhost',
          POSTGRES_DB: 'bitbrat',
          POSTGRES_USER: 'bitbrat',
          // No DATABASE_URL, but has individual vars
        });

        const result = await validateContext({
          repoRoot,
          contextName,
          context: {},
        });

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });
  });

  describe('formatValidationResult', () => {
    it('should format successful validation', () => {
      const result: ValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
      };

      const output = formatValidationResult(contextName, result);

      expect(output).toContain('✅ Validation PASSED');
      expect(output).toContain('ready for deployment');
      expect(output).not.toContain('❌');
    });

    it('should format validation with warnings', () => {
      const result: ValidationResult = {
        valid: true,
        errors: [],
        warnings: [
          {
            check: 'firestore-deprecated',
            message: 'Using deprecated Firestore',
            recommendation: 'Migrate to PostgreSQL',
          },
        ],
      };

      const output = formatValidationResult(contextName, result);

      expect(output).toContain('✅ Validation PASSED');
      expect(output).toContain('⚠️');
      expect(output).toContain('deprecated Firestore');
      expect(output).toContain('Migrate to PostgreSQL');
    });

    it('should format failed validation', () => {
      const result: ValidationResult = {
        valid: false,
        errors: [
          {
            check: 'secure-file',
            message: '.secure.test-context not found',
            fix: 'Create .secure.test-context',
          },
        ],
        warnings: [],
      };

      const output = formatValidationResult(contextName, result);

      expect(output).toContain('❌ Validation FAILED');
      expect(output).toContain('.secure.test-context not found');
      expect(output).toContain('Fix: Create .secure.test-context');
    });

    it('should format validation with errors and warnings', () => {
      const result: ValidationResult = {
        valid: false,
        errors: [
          {
            check: 'env-directory',
            message: 'env/test-context not found',
          },
        ],
        warnings: [
          {
            check: 'firestore-deprecated',
            message: 'Using Firestore',
          },
        ],
      };

      const output = formatValidationResult(contextName, result);

      expect(output).toContain('❌ Validation FAILED');
      expect(output).toContain('env/test-context not found');
      expect(output).toContain('⚠️');
      expect(output).toContain('Using Firestore');
    });

    it('should include context name in header', () => {
      const result: ValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
      };

      const output = formatValidationResult('production', result);

      expect(output).toContain('Validating context: production');
    });

    it('should include separators for readability', () => {
      const result: ValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
      };

      const output = formatValidationResult(contextName, result);

      expect(output).toContain('='.repeat(60));
    });
  });
});

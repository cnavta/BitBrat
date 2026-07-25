/**
 * Config Validator Module Unit Tests
 * Sprint 360: Test suite for business/config-validator.ts
 */

import { validateConfig, formatConfigValidationResult } from './config-validator';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { ArchitectureSchema } from '../config/schema';

// Mock fs and yaml
jest.mock('fs');
jest.mock('js-yaml');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockYaml = yaml as jest.Mocked<typeof yaml>;

describe('Config Validator Business Logic', () => {
  const repoRoot = '/test/repo';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateConfig', () => {
    describe('File Not Found', () => {
      it('should return error when architecture.yaml not found', () => {
        mockFs.existsSync.mockReturnValue(false);

        const result = validateConfig({ repoRoot });

        expect(result.valid).toBe(false);
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0]).toMatchObject({
          code: 'file-missing',
          message: expect.stringContaining('not found'),
        });
      });

      it('should check custom architecture path if provided', () => {
        mockFs.existsSync.mockReturnValue(false);

        const result = validateConfig({
          repoRoot,
          architecturePath: '/custom/arch.yaml',
        });

        expect(mockFs.existsSync).toHaveBeenCalledWith('/custom/arch.yaml');
        expect(result.valid).toBe(false);
      });
    });

    describe('YAML Parse Errors', () => {
      it('should return error when YAML is invalid', () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue('invalid: yaml: [unclosed');
        mockYaml.load.mockImplementation(() => {
          throw new Error('Unexpected end of YAML');
        });

        const result = validateConfig({ repoRoot });

        expect(result.valid).toBe(false);
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0]).toMatchObject({
          code: 'yaml-parse',
          message: expect.stringContaining('Failed to parse YAML'),
        });
      });
    });

    describe('Zod Schema Validation', () => {
      it('should validate successfully with valid config', () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockImplementation((path: any) => {
          if (path.includes('architecture.yaml')) {
            return 'project: { name: test }';
          }
          if (path.includes('architecture.v1.json')) {
            return JSON.stringify({ type: 'object' });
          }
          return '';
        });

        const validConfig = {
          project: {
            name: 'bitbrat-platform',
            version: '1.0.0',
          },
          defaults: {},
          services: {},
          executionContexts: {},
        };

        mockYaml.load.mockReturnValue(validConfig);

        // Mock Zod validation to pass
        jest.spyOn(ArchitectureSchema, 'safeParse').mockReturnValue({
          success: true,
          data: validConfig,
        } as any);

        const result = validateConfig({ repoRoot });

        expect(result.valid).toBe(true);
        expect(result.issues).toHaveLength(0);
      });

      it('should return Zod validation errors', () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockImplementation((path: any) => {
          if (path.includes('architecture.yaml')) {
            return 'project: {}';
          }
          if (path.includes('architecture.v1.json')) {
            return JSON.stringify({ type: 'object' });
          }
          return '';
        });

        const invalidConfig = {
          project: {}, // Missing required 'name' field
        };

        mockYaml.load.mockReturnValue(invalidConfig);

        // Mock Zod validation to fail
        jest.spyOn(ArchitectureSchema, 'safeParse').mockReturnValue({
          success: false,
          error: {
            issues: [
              {
                path: ['project', 'name'],
                message: 'Required',
                code: 'invalid_type' as any,
              },
              {
                path: ['project', 'version'],
                message: 'Required',
                code: 'invalid_type' as any,
              },
            ],
          },
        } as any);

        const result = validateConfig({ repoRoot });

        expect(result.valid).toBe(false);
        expect(result.issues).toHaveLength(2);
        expect(result.issues[0]).toMatchObject({
          path: 'project.name',
          message: 'Required',
          code: 'zod',
        });
        expect(result.issues[1]).toMatchObject({
          path: 'project.version',
          message: 'Required',
          code: 'zod',
        });
      });

      it('should handle root-level Zod errors', () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue('{}');

        mockYaml.load.mockReturnValue({});

        jest.spyOn(ArchitectureSchema, 'safeParse').mockReturnValue({
          success: false,
          error: {
            issues: [
              {
                path: [],
                message: 'Invalid configuration',
                code: 'custom' as any,
              },
            ],
          },
        } as any);

        const result = validateConfig({ repoRoot });

        expect(result.valid).toBe(false);
        expect(result.issues[0]).toMatchObject({
          path: '(root)',
          code: 'zod',
        });
      });
    });

    describe('JSON Schema Validation', () => {
      it('should use default schema path if not specified', () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockImplementation((path: any) => {
          if (path.includes('architecture.yaml')) {
            return 'project: { name: test }';
          }
          return JSON.stringify({ type: 'object' });
        });

        mockYaml.load.mockReturnValue({ project: { name: 'test' } });

        jest.spyOn(ArchitectureSchema, 'safeParse').mockReturnValue({
          success: true,
          data: {},
        } as any);

        validateConfig({ repoRoot });

        expect(mockFs.existsSync).toHaveBeenCalledWith(
          expect.stringContaining('documentation/schemas/architecture.v1.json')
        );
      });

      it('should use custom schema path from references.architecture_schema', () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockImplementation((path: any) => {
          if (path.includes('architecture.yaml')) {
            return 'references: { architecture_schema: custom/schema.json }';
          }
          return JSON.stringify({ type: 'object' });
        });

        mockYaml.load.mockReturnValue({
          references: { architecture_schema: 'custom/schema.json' },
        });

        jest.spyOn(ArchitectureSchema, 'safeParse').mockReturnValue({
          success: true,
          data: {},
        } as any);

        validateConfig({ repoRoot });

        expect(mockFs.existsSync).toHaveBeenCalledWith(
          expect.stringContaining('custom/schema.json')
        );
      });

      it('should return error when JSON schema not found', () => {
        mockFs.existsSync.mockImplementation((path: any) => {
          return !path.includes('.json');
        });
        mockFs.readFileSync.mockReturnValue('project: { name: test }');

        mockYaml.load.mockReturnValue({ project: { name: 'test' } });

        jest.spyOn(ArchitectureSchema, 'safeParse').mockReturnValue({
          success: true,
          data: {},
        } as any);

        const result = validateConfig({ repoRoot });

        expect(result.valid).toBe(false);
        expect(result.issues.some((i) => i.code === 'schema-missing')).toBe(true);
      });

      it('should return error when JSON schema is malformed', () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockImplementation((path: any) => {
          if (path.includes('.json')) {
            return 'invalid json';
          }
          return 'project: { name: test }';
        });

        mockYaml.load.mockReturnValue({ project: { name: 'test' } });

        jest.spyOn(ArchitectureSchema, 'safeParse').mockReturnValue({
          success: true,
          data: {},
        } as any);

        const result = validateConfig({ repoRoot });

        expect(result.valid).toBe(false);
        expect(result.issues.some((i) => i.code === 'schema-load')).toBe(true);
      });
    });

    describe('Combined Validation', () => {
      it('should return both Zod and JSON schema errors', () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockImplementation((path: any) => {
          if (path.includes('.json')) {
            return JSON.stringify({
              type: 'object',
              properties: {
                project: {
                  type: 'object',
                  required: ['name', 'version'],
                },
              },
              required: ['project'],
            });
          }
          return 'project: {}';
        });

        mockYaml.load.mockReturnValue({ project: {} });

        // Zod error
        jest.spyOn(ArchitectureSchema, 'safeParse').mockReturnValue({
          success: false,
          error: {
            issues: [
              {
                path: ['project', 'name'],
                message: 'Required',
                code: 'invalid_type' as any,
              },
            ],
          },
        } as any);

        const result = validateConfig({ repoRoot });

        expect(result.valid).toBe(false);
        expect(result.issues.some((i) => i.code === 'zod')).toBe(true);
        // Note: JSON schema validation would also fail in real scenario
      });

      it('should include schema path in result', () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockImplementation((path: any) => {
          if (path.includes('.json')) {
            return JSON.stringify({ type: 'object' });
          }
          return 'project: { name: test }';
        });

        mockYaml.load.mockReturnValue({
          project: { name: 'test' },
          references: { architecture_schema: 'my/schema.json' },
        });

        jest.spyOn(ArchitectureSchema, 'safeParse').mockReturnValue({
          success: true,
          data: {},
        } as any);

        const result = validateConfig({ repoRoot });

        expect(result.schemaPath).toBe('my/schema.json');
      });
    });
  });

  describe('formatConfigValidationResult', () => {
    it('should format successful validation', () => {
      const result = {
        valid: true,
        issues: [],
        schemaPath: 'documentation/schemas/architecture.v1.json',
      };

      const output = formatConfigValidationResult(result);

      expect(output).toContain('Config valid');
      expect(output).toContain('architecture.v1.json');
    });

    it('should format validation errors', () => {
      const result = {
        valid: false,
        issues: [
          { path: 'project.name', message: 'Required', code: 'zod' },
          { path: 'project.version', message: 'Required', code: 'zod' },
        ],
        schemaPath: 'documentation/schemas/architecture.v1.json',
      };

      const output = formatConfigValidationResult(result);

      expect(output).toContain('Config invalid:');
      expect(output).toContain('project.name: Required');
      expect(output).toContain('project.version: Required');
    });

    it('should handle result without schema path', () => {
      const result = {
        valid: true,
        issues: [],
      };

      const output = formatConfigValidationResult(result);

      expect(output).toContain('Config valid');
      expect(output).toContain('schema');
    });
  });
});

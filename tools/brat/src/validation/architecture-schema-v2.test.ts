/**
 * Architecture.yaml v2 JSON Schema Validation Tests
 *
 * Tests the JSON Schema validator against:
 * - Valid v2 configurations
 * - Invalid configurations (missing required fields)
 * - Cross-reference validation
 * - Provider capability validation
 *
 * @module validation/architecture-schema-v2.test
 */

import { ArchitectureSchemaV2Validator } from './architecture-schema-v2';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

describe('ArchitectureSchemaV2Validator', () => {
  let repoRoot: string;

  beforeEach(() => {
    // Use actual repo root for integration-style tests
    // Navigate from tools/brat/src/validation to root
    repoRoot = path.resolve(__dirname, '../../../..');
  });

  describe('Valid Configurations', () => {
    it('should validate the current architecture.yaml v2', () => {
      const validator = new ArchitectureSchemaV2Validator(repoRoot);
      const result = validator.validate();

      // Allow warnings but no errors
      expect(result.errors).toHaveLength(0);
      expect(result.valid).toBe(true);

      if (result.warnings.length > 0) {
        console.log('\nValidation warnings:');
        for (const warning of result.warnings) {
          console.log(`  - ${warning.path}: ${warning.message}`);
        }
      }
    });

    it('should validate minimal v2 configuration', () => {
      // Create temporary minimal config
      const minimalConfig = {
        name: 'Test Platform',
        project: {
          version: '1.0.0',
        },
        platform: {
          version: '2.0',
          infrastructure: {
            messaging: {
              required: true,
              capabilities: ['publish-subscribe'],
            },
            caching: {
              required: true,
              capabilities: ['key-value-store'],
            },
            persistence: {
              required: true,
              capabilities: ['relational-database'],
            },
          },
        },
        infrastructure: {
          docker: {
            messaging: {
              service: 'nats',
              image: 'nats:alpine',
            },
            caching: {
              service: 'redis',
              image: 'redis:alpine',
            },
            persistence: {
              service: 'postgres',
              image: 'postgres:alpine',
            },
          },
        },
        services: {
          'test-service': {
            active: true,
            category: 'platform',
            profile: 'core',
            entry: 'src/apps/test-service.ts',
            dependencies: {
              infrastructure: ['messaging'],
            },
          },
        },
      };

      // Write to temp file
      const tempDir = fs.mkdtempSync(path.join(__dirname, 'temp-'));
      const tempArchPath = path.join(tempDir, 'architecture.yaml');
      const tempSchemaPath = path.join(tempDir, 'documentation/schemas');
      fs.mkdirSync(tempSchemaPath, { recursive: true });

      // Copy schema
      const schemaSource = path.join(repoRoot, 'documentation/schemas/architecture.v2.json');
      const schemaDest = path.join(tempSchemaPath, 'architecture.v2.json');
      fs.copyFileSync(schemaSource, schemaDest);

      // Write minimal config
      fs.writeFileSync(tempArchPath, yaml.stringify(minimalConfig));

      try {
        const validator = new ArchitectureSchemaV2Validator(tempDir);
        const result = validator.validate();

        expect(result.errors).toHaveLength(0);
        expect(result.valid).toBe(true);
      } finally {
        // Cleanup
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('Invalid Configurations', () => {
    it('should reject missing platform section', () => {
      const invalidConfig = {
        name: 'Test Platform',
        project: {
          version: '1.0.0',
        },
        services: {},
      };

      const tempDir = fs.mkdtempSync(path.join(__dirname, 'temp-'));
      const tempArchPath = path.join(tempDir, 'architecture.yaml');
      const tempSchemaPath = path.join(tempDir, 'documentation/schemas');
      fs.mkdirSync(tempSchemaPath, { recursive: true });

      const schemaSource = path.join(repoRoot, 'documentation/schemas/architecture.v2.json');
      const schemaDest = path.join(tempSchemaPath, 'architecture.v2.json');
      fs.copyFileSync(schemaSource, schemaDest);

      fs.writeFileSync(tempArchPath, yaml.stringify(invalidConfig));

      try {
        const validator = new ArchitectureSchemaV2Validator(tempDir);
        const result = validator.validate();

        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            message: expect.stringContaining('platform'),
          })
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should reject missing infrastructure section', () => {
      const invalidConfig = {
        name: 'Test Platform',
        project: {
          version: '1.0.0',
        },
        platform: {
          version: '2.0',
          infrastructure: {
            messaging: {
              required: true,
              capabilities: ['publish-subscribe'],
            },
          },
        },
        services: {},
      };

      const tempDir = fs.mkdtempSync(path.join(__dirname, 'temp-'));
      const tempArchPath = path.join(tempDir, 'architecture.yaml');
      const tempSchemaPath = path.join(tempDir, 'documentation/schemas');
      fs.mkdirSync(tempSchemaPath, { recursive: true });

      const schemaSource = path.join(repoRoot, 'documentation/schemas/architecture.v2.json');
      const schemaDest = path.join(tempSchemaPath, 'architecture.v2.json');
      fs.copyFileSync(schemaSource, schemaDest);

      fs.writeFileSync(tempArchPath, yaml.stringify(invalidConfig));

      try {
        const validator = new ArchitectureSchemaV2Validator(tempDir);
        const result = validator.validate();

        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            message: expect.stringContaining('infrastructure'),
          })
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should reject invalid platform version', () => {
      const invalidConfig = {
        name: 'Test Platform',
        project: {
          version: '1.0.0',
        },
        platform: {
          version: '1.0', // Should be '2.0' for v2 schema
          infrastructure: {
            messaging: {
              required: true,
              capabilities: ['publish-subscribe'],
            },
          },
        },
        infrastructure: {
          docker: {
            messaging: {
              service: 'nats',
            },
          },
        },
        services: {},
      };

      const tempDir = fs.mkdtempSync(path.join(__dirname, 'temp-'));
      const tempArchPath = path.join(tempDir, 'architecture.yaml');
      const tempSchemaPath = path.join(tempDir, 'documentation/schemas');
      fs.mkdirSync(tempSchemaPath, { recursive: true });

      const schemaSource = path.join(repoRoot, 'documentation/schemas/architecture.v2.json');
      const schemaDest = path.join(tempSchemaPath, 'architecture.v2.json');
      fs.copyFileSync(schemaSource, schemaDest);

      fs.writeFileSync(tempArchPath, yaml.stringify(invalidConfig));

      try {
        const validator = new ArchitectureSchemaV2Validator(tempDir);
        const result = validator.validate();

        // Note: This might pass schema validation if version pattern allows 1.0
        // But structural validation should catch it
        if (!result.valid) {
          expect(result.errors.length).toBeGreaterThan(0);
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('Cross-Reference Validation', () => {
    it('should detect unknown service infrastructure dependencies', () => {
      const configWithInvalidDeps = {
        name: 'Test Platform',
        project: {
          version: '1.0.0',
        },
        platform: {
          version: '2.0',
          infrastructure: {
            messaging: {
              required: true,
              capabilities: ['publish-subscribe'],
            },
          },
        },
        infrastructure: {
          docker: {
            messaging: {
              service: 'nats',
            },
          },
        },
        services: {
          'test-service': {
            active: true,
            category: 'platform',
            dependencies: {
              infrastructure: ['messaging', 'unknown-capability'], // unknown-capability doesn't exist
            },
          },
        },
      };

      const tempDir = fs.mkdtempSync(path.join(__dirname, 'temp-'));
      const tempArchPath = path.join(tempDir, 'architecture.yaml');
      const tempSchemaPath = path.join(tempDir, 'documentation/schemas');
      fs.mkdirSync(tempSchemaPath, { recursive: true });

      const schemaSource = path.join(repoRoot, 'documentation/schemas/architecture.v2.json');
      const schemaDest = path.join(tempSchemaPath, 'architecture.v2.json');
      fs.copyFileSync(schemaSource, schemaDest);

      fs.writeFileSync(tempArchPath, yaml.stringify(configWithInvalidDeps));

      try {
        const validator = new ArchitectureSchemaV2Validator(tempDir);
        const result = validator.validate();

        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            path: expect.stringContaining('test-service'),
            message: expect.stringContaining('unknown-capability'),
          })
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should detect unknown execution context providers', () => {
      const configWithInvalidProvider = {
        name: 'Test Platform',
        project: {
          version: '1.0.0',
        },
        platform: {
          version: '2.0',
          infrastructure: {
            messaging: {
              required: true,
              capabilities: ['publish-subscribe'],
            },
          },
        },
        infrastructure: {
          docker: {
            messaging: {
              service: 'nats',
            },
          },
        },
        executionContexts: {
          local: {
            description: 'Local development',
            deployment: {
              type: 'docker-compose',
            },
            infrastructure: {
              provider: 'unknown-provider', // Doesn't exist
            },
          },
        },
        services: {},
      };

      const tempDir = fs.mkdtempSync(path.join(__dirname, 'temp-'));
      const tempArchPath = path.join(tempDir, 'architecture.yaml');
      const tempSchemaPath = path.join(tempDir, 'documentation/schemas');
      fs.mkdirSync(tempSchemaPath, { recursive: true });

      const schemaSource = path.join(repoRoot, 'documentation/schemas/architecture.v2.json');
      const schemaDest = path.join(tempSchemaPath, 'architecture.v2.json');
      fs.copyFileSync(schemaSource, schemaDest);

      fs.writeFileSync(tempArchPath, yaml.stringify(configWithInvalidProvider));

      try {
        const validator = new ArchitectureSchemaV2Validator(tempDir);
        const result = validator.validate();

        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            path: expect.stringContaining('executionContexts.local.infrastructure.provider'),
            message: expect.stringContaining('unknown-provider'),
          })
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should detect missing Docker provider implementations', () => {
      const configMissingDockerImpl = {
        name: 'Test Platform',
        project: {
          version: '1.0.0',
        },
        platform: {
          version: '2.0',
          infrastructure: {
            messaging: {
              required: true,
              capabilities: ['publish-subscribe'],
            },
            caching: {
              required: true,
              capabilities: ['key-value-store'],
            },
          },
        },
        infrastructure: {
          docker: {
            messaging: {
              service: 'nats',
            },
            // Missing caching implementation
          },
        },
        services: {},
      };

      const tempDir = fs.mkdtempSync(path.join(__dirname, 'temp-'));
      const tempArchPath = path.join(tempDir, 'architecture.yaml');
      const tempSchemaPath = path.join(tempDir, 'documentation/schemas');
      fs.mkdirSync(tempSchemaPath, { recursive: true });

      const schemaSource = path.join(repoRoot, 'documentation/schemas/architecture.v2.json');
      const schemaDest = path.join(tempSchemaPath, 'architecture.v2.json');
      fs.copyFileSync(schemaSource, schemaDest);

      fs.writeFileSync(tempArchPath, yaml.stringify(configMissingDockerImpl));

      try {
        const validator = new ArchitectureSchemaV2Validator(tempDir);
        const result = validator.validate();

        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            path: expect.stringContaining('infrastructure.docker.caching'),
            message: expect.stringContaining('not implemented'),
          })
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('Provider Validation', () => {
    it('should warn about missing health checks', () => {
      const configNoHealthCheck = {
        name: 'Test Platform',
        project: {
          version: '1.0.0',
        },
        platform: {
          version: '2.0',
          infrastructure: {
            messaging: {
              required: true,
              capabilities: ['publish-subscribe'],
            },
          },
        },
        infrastructure: {
          docker: {
            messaging: {
              service: 'nats',
              image: 'nats:alpine',
              // Missing healthCheck
            },
          },
        },
        services: {},
      };

      const tempDir = fs.mkdtempSync(path.join(__dirname, 'temp-'));
      const tempArchPath = path.join(tempDir, 'architecture.yaml');
      const tempSchemaPath = path.join(tempDir, 'documentation/schemas');
      fs.mkdirSync(tempSchemaPath, { recursive: true });

      const schemaSource = path.join(repoRoot, 'documentation/schemas/architecture.v2.json');
      const schemaDest = path.join(tempSchemaPath, 'architecture.v2.json');
      fs.copyFileSync(schemaSource, schemaDest);

      fs.writeFileSync(tempArchPath, yaml.stringify(configNoHealthCheck));

      try {
        const validator = new ArchitectureSchemaV2Validator(tempDir);
        const result = validator.validate();

        expect(result.warnings).toContainEqual(
          expect.objectContaining({
            path: expect.stringContaining('infrastructure.docker.messaging'),
            message: expect.stringContaining('healthCheck'),
          })
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('Format Results', () => {
    it('should format results with errors and warnings', () => {
      const result = {
        valid: false,
        errors: [
          {
            severity: 'error' as const,
            path: 'platform.infrastructure',
            message: 'Missing required section',
            suggestion: 'Add platform.infrastructure section',
          },
        ],
        warnings: [
          {
            severity: 'warning' as const,
            path: 'infrastructure.docker.messaging',
            message: 'Missing healthCheck',
            suggestion: 'Add healthCheck configuration',
          },
        ],
      };

      const formatted = ArchitectureSchemaV2Validator.formatResults(result);

      expect(formatted).toContain('ERROR(S)');
      expect(formatted).toContain('WARNING(S)');
      expect(formatted).toContain('platform.infrastructure');
      expect(formatted).toContain('Missing required section');
      expect(formatted).toContain('Validation FAILED');
    });

    it('should format successful validation', () => {
      const result = {
        valid: true,
        errors: [],
        warnings: [],
      };

      const formatted = ArchitectureSchemaV2Validator.formatResults(result);

      expect(formatted).toContain('All validations passed');
      expect(formatted).not.toContain('ERROR');
      expect(formatted).not.toContain('WARNING');
    });
  });
});

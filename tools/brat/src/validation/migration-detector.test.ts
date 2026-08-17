/**
 * Migration Detector Tests
 * Sprint 6: S6-M2.1
 *
 * Tests for v1 → v2 schema migration detection and reporting.
 */

import { MigrationDetector } from './migration-detector';
import type { SchemaVersion } from './migration-detector';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

describe('MigrationDetector', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(__dirname, 'temp-migration-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Version Detection', () => {
    it('should detect v2 schema with platform.version', () => {
      const v2Config = {
        name: 'Test',
        project: { version: '1.0.0' },
        platform: {
          version: '2.0',
          infrastructure: {
            messaging: { required: true, capabilities: ['publish-subscribe'] },
          },
        },
        infrastructure: {
          docker: {
            messaging: { service: 'nats' },
          },
        },
        services: {},
      };

      writeArchitecture(tempDir, v2Config);
      const detector = new MigrationDetector(tempDir);
      expect(detector.detectVersion()).toBe('v2');
    });

    it('should detect v2 schema with platform.infrastructure', () => {
      const v2Config = {
        name: 'Test',
        project: { version: '1.0.0' },
        platform: {
          infrastructure: {
            messaging: { required: true, capabilities: ['publish-subscribe'] },
          },
        },
        infrastructure: {
          docker: {
            messaging: { service: 'nats' },
          },
        },
        services: {},
      };

      writeArchitecture(tempDir, v2Config);
      const detector = new MigrationDetector(tempDir);
      expect(detector.detectVersion()).toBe('v2');
    });

    it('should detect v2 schema with infrastructure.docker capabilities', () => {
      const v2Config = {
        name: 'Test',
        project: { version: '1.0.0' },
        infrastructure: {
          docker: {
            messaging: { service: 'nats' },
            caching: { service: 'redis' },
          },
        },
        services: {},
      };

      writeArchitecture(tempDir, v2Config);
      const detector = new MigrationDetector(tempDir);
      expect(detector.detectVersion()).toBe('v2');
    });

    it('should detect v2 schema with service infrastructure dependencies', () => {
      const v2Config = {
        name: 'Test',
        project: { version: '1.0.0' },
        services: {
          'test-service': {
            active: true,
            dependencies: {
              infrastructure: ['messaging'],
            },
          },
        },
      };

      writeArchitecture(tempDir, v2Config);
      const detector = new MigrationDetector(tempDir);
      expect(detector.detectVersion()).toBe('v2');
    });

    it('should detect v1 schema with infrastructure.gcp.resources', () => {
      const v1Config = {
        name: 'Test',
        project: { version: '1.0.0' },
        infrastructure: {
          gcp: {
            resources: {
              pubsub: ['topic1', 'topic2'],
            },
          },
        },
        services: {},
      };

      writeArchitecture(tempDir, v1Config);
      const detector = new MigrationDetector(tempDir);
      expect(detector.detectVersion()).toBe('v1');
    });

    it('should detect v1 schema with infrastructure.target', () => {
      const v1Config = {
        name: 'Test',
        project: { version: '1.0.0' },
        infrastructure: {
          target: 'gcp',
        },
        services: {},
      };

      writeArchitecture(tempDir, v1Config);
      const detector = new MigrationDetector(tempDir);
      expect(detector.detectVersion()).toBe('v1');
    });

    it('should detect v1 for minimal config without v2 markers', () => {
      const v1Config = {
        name: 'Test',
        project: { version: '1.0.0' },
        services: {
          'test-service': {
            active: true,
          },
        },
      };

      writeArchitecture(tempDir, v1Config);
      const detector = new MigrationDetector(tempDir);
      expect(detector.detectVersion()).toBe('v1');
    });
  });

  describe('Migration Report Generation', () => {
    it('should report no migration needed for v2 config', () => {
      const v2Config = {
        name: 'Test',
        project: { version: '1.0.0' },
        platform: {
          version: '2.0',
          infrastructure: {
            messaging: { required: true, capabilities: ['publish-subscribe'] },
          },
        },
        infrastructure: {
          docker: {
            messaging: { service: 'nats' },
          },
        },
        services: {},
      };

      writeArchitecture(tempDir, v2Config);
      const detector = new MigrationDetector(tempDir);
      const report = detector.generateMigrationReport();

      expect(report.detectedVersion).toBe('v2');
      expect(report.breaking).toHaveLength(0);
      expect(report.info).toContainEqual(
        expect.objectContaining({
          message: 'Already using v2 schema',
        })
      );
      expect(report.estimatedEffort).toBe('0 hours');
      expect(report.riskLevel).toBe('low');
    });

    it('should detect missing platform.infrastructure', () => {
      const v1Config = {
        name: 'Test',
        project: { version: '1.0.0' },
        services: {},
      };

      writeArchitecture(tempDir, v1Config);
      const detector = new MigrationDetector(tempDir);
      const report = detector.generateMigrationReport();

      expect(report.detectedVersion).toBe('v1');
      expect(report.breaking).toContainEqual(
        expect.objectContaining({
          path: 'platform.infrastructure',
          severity: 'breaking',
          message: 'Missing platform.infrastructure section',
        })
      );
    });

    it('should detect missing platform.version', () => {
      const v1Config = {
        name: 'Test',
        project: { version: '1.0.0' },
        services: {},
      };

      writeArchitecture(tempDir, v1Config);
      const detector = new MigrationDetector(tempDir);
      const report = detector.generateMigrationReport();

      expect(report.breaking).toContainEqual(
        expect.objectContaining({
          path: 'platform.version',
          severity: 'breaking',
          message: 'Missing or incorrect platform.version',
        })
      );
    });

    it('should detect missing infrastructure.docker', () => {
      const v1Config = {
        name: 'Test',
        project: { version: '1.0.0' },
        infrastructure: {
          gcp: {
            resources: {},
          },
        },
        services: {},
      };

      writeArchitecture(tempDir, v1Config);
      const detector = new MigrationDetector(tempDir);
      const report = detector.generateMigrationReport();

      expect(report.breaking).toContainEqual(
        expect.objectContaining({
          path: 'infrastructure.docker',
          severity: 'breaking',
          message: 'Missing infrastructure.docker provider',
        })
      );
    });

    it('should detect legacy infrastructure.gcp.resources pattern', () => {
      const v1Config = {
        name: 'Test',
        project: { version: '1.0.0' },
        infrastructure: {
          gcp: {
            resources: {
              pubsub: ['topic1'],
            },
          },
        },
        services: {},
      };

      writeArchitecture(tempDir, v1Config);
      const detector = new MigrationDetector(tempDir);
      const report = detector.generateMigrationReport();

      expect(report.breaking).toContainEqual(
        expect.objectContaining({
          path: 'infrastructure.gcp.resources',
          severity: 'breaking',
          message: 'Legacy infrastructure.gcp.resources pattern detected',
        })
      );
    });

    it('should warn about legacy infrastructure.target', () => {
      const v1Config = {
        name: 'Test',
        project: { version: '1.0.0' },
        infrastructure: {
          target: 'gcp',
        },
        services: {},
      };

      writeArchitecture(tempDir, v1Config);
      const detector = new MigrationDetector(tempDir);
      const report = detector.generateMigrationReport();

      expect(report.warnings).toContainEqual(
        expect.objectContaining({
          path: 'infrastructure.target',
          severity: 'warning',
          message: 'Legacy infrastructure.target field detected',
        })
      );
    });

    it('should warn about services without infrastructure dependencies', () => {
      const v1Config = {
        name: 'Test',
        project: { version: '1.0.0' },
        services: {
          'service1': { active: true },
          'service2': { active: true },
          'service3': { active: false }, // Inactive, should not warn
        },
      };

      writeArchitecture(tempDir, v1Config);
      const detector = new MigrationDetector(tempDir);
      const report = detector.generateMigrationReport();

      expect(report.warnings).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('2 active service(s) missing infrastructure dependencies'),
        })
      );
    });

    it('should warn about execution contexts without infrastructure.provider', () => {
      const v1Config = {
        name: 'Test',
        project: { version: '1.0.0' },
        executionContexts: {
          local: {
            description: 'Local',
            deployment: { type: 'docker-compose' },
          },
          staging: {
            description: 'Staging',
            deployment: { type: 'docker-compose' },
          },
        },
        services: {},
      };

      writeArchitecture(tempDir, v1Config);
      const detector = new MigrationDetector(tempDir);
      const report = detector.generateMigrationReport();

      expect(report.warnings).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('2 execution context(s) missing infrastructure.provider'),
        })
      );
    });

    it('should estimate effort based on issue count', () => {
      const v1ConfigMinimal = {
        name: 'Test',
        project: { version: '1.0.0' },
        services: {},
      };

      writeArchitecture(tempDir, v1ConfigMinimal);
      const detector = new MigrationDetector(tempDir);
      const report = detector.generateMigrationReport();

      // Should have 3 breaking changes (platform.infrastructure, platform.version, infrastructure.docker)
      expect(report.breaking.length).toBe(3);
      expect(report.estimatedEffort).toBe('1-2 hours');
      expect(report.riskLevel).toBe('low');
    });

    it('should increase effort estimate for complex migrations', () => {
      const v1ConfigComplex = {
        name: 'Test',
        project: { version: '1.0.0' },
        infrastructure: {
          gcp: {
            resources: { pubsub: ['t1'] },
          },
          target: 'gcp',
        },
        services: {
          s1: { active: true },
          s2: { active: true },
          s3: { active: true },
          s4: { active: true },
          s5: { active: true },
          s6: { active: true },
        },
        executionContexts: {
          local: { deployment: { type: 'docker-compose' } },
          staging: { deployment: { type: 'docker-compose' } },
          prod: { deployment: { type: 'cloud-run' } },
        },
      };

      writeArchitecture(tempDir, v1ConfigComplex);
      const detector = new MigrationDetector(tempDir);
      const report = detector.generateMigrationReport();

      // Should have many warnings
      expect(report.warnings.length).toBeGreaterThan(1);
      expect(report.riskLevel).not.toBe('low');
    });
  });

  describe('Report Formatting', () => {
    it('should format migration report as text', () => {
      const v1Config = {
        name: 'Test',
        project: { version: '1.0.0' },
        services: {},
      };

      writeArchitecture(tempDir, v1Config);
      const detector = new MigrationDetector(tempDir);
      const report = detector.generateMigrationReport();
      const formatted = MigrationDetector.formatMigrationReport(report);

      expect(formatted).toContain('MIGRATION REPORT');
      expect(formatted).toContain('Detected Version: v1');
      expect(formatted).toContain('Target Version: v2');
      expect(formatted).toContain('BREAKING CHANGES');
      expect(formatted).toContain('MIGRATION PATH');
    });

    it('should format v2 report as already migrated', () => {
      const v2Config = {
        name: 'Test',
        project: { version: '1.0.0' },
        platform: {
          version: '2.0',
          infrastructure: {
            messaging: { required: true, capabilities: ['publish-subscribe'] },
          },
        },
        infrastructure: {
          docker: {
            messaging: { service: 'nats' },
          },
        },
        services: {},
      };

      writeArchitecture(tempDir, v2Config);
      const detector = new MigrationDetector(tempDir);
      const report = detector.generateMigrationReport();
      const formatted = MigrationDetector.formatMigrationReport(report);

      expect(formatted).toContain('Already using v2 schema');
      expect(formatted).toContain('no migration needed');
    });
  });
});

/**
 * Helper: Write architecture config to temp directory
 */
function writeArchitecture(dir: string, config: any): void {
  const archPath = path.join(dir, 'architecture.yaml');
  fs.writeFileSync(archPath, yaml.stringify(config));
}

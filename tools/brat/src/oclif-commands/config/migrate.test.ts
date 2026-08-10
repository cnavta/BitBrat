/**
 * oclif Command Tests: config migrate
 * Sprint 6: S6-M2.1
 *
 * Smoke tests for migration command structure and flags.
 * Business logic is tested in migration-detector.test.ts (18 tests).
 */

import ConfigMigrate from './migrate';
import { BratCommand } from '../base';

describe('oclif Command: config migrate (Smoke Tests)', () => {
  describe('Class Structure', () => {
    it('should extend BratCommand', () => {
      expect(ConfigMigrate.prototype).toBeInstanceOf(BratCommand);
    });

    it('should have description', () => {
      expect(ConfigMigrate.description).toBe(
        'Detect schema version and generate v1 → v2 migration guidance'
      );
    });

    it('should have examples', () => {
      expect(ConfigMigrate.examples).toBeDefined();
      expect(ConfigMigrate.examples.length).toBe(4);
      expect(ConfigMigrate.examples[0]).toContain('command.id');
      expect(ConfigMigrate.examples[1]).toContain('--dry-run');
      expect(ConfigMigrate.examples[2]).toContain('--format json');
    });
  });

  describe('Flags', () => {
    it('should have dry-run flag', () => {
      expect(ConfigMigrate.flags['dry-run']).toBeDefined();
      expect((ConfigMigrate.flags['dry-run'] as any).default).toBe(true);
    });

    it('should have format flag', () => {
      expect(ConfigMigrate.flags.format).toBeDefined();
      expect((ConfigMigrate.flags.format as any).options).toEqual(['text', 'json', 'yaml']);
      expect((ConfigMigrate.flags.format as any).default).toBe('text');
    });

    it('should inherit BratCommand baseFlags', () => {
      expect(ConfigMigrate.flags).toHaveProperty('context');
      expect(ConfigMigrate.flags).toHaveProperty('verbose');
    });
  });

  describe('Command Metadata', () => {
    it('should be properly configured for oclif', () => {
      // Verify oclif can instantiate the command
      const command = new ConfigMigrate([], {} as any);
      expect(command).toBeInstanceOf(ConfigMigrate);
      expect(command).toBeInstanceOf(BratCommand);
    });
  });
});

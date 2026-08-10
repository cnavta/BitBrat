/**
 * oclif Command Tests: config validate
 * Sprint 360: CFG-001
 * Sprint 6: S6-F1.2 - Add --schema v2 tests
 *
 * NOTE: Smoke tests only. Comprehensive testing with business logic mocks
 * deferred to Phase 4. See sprint-360 shared-business-logic-analysis.md
 * for testing strategy rationale.
 *
 * Business logic is tested separately in:
 * - validateConfig (business/config-validator.test.ts) - 15 tests
 * - formatConfigValidationResult (business/config-validator.test.ts)
 * - ArchitectureSchemaV2Validator (validation/architecture-schema-v2.test.ts) - 11 tests
 */

import ConfigValidate from './validate';
import { BratCommand } from '../base';

describe('oclif Command: config validate (Smoke Tests)', () => {
  describe('Class Structure', () => {
    it('should extend BratCommand', () => {
      expect(ConfigValidate.prototype).toBeInstanceOf(BratCommand);
    });

    it('should have description', () => {
      expect(ConfigValidate.description).toBe('Validate architecture.yaml configuration');
    });

    it('should have examples', () => {
      expect(ConfigValidate.examples).toBeDefined();
      expect(ConfigValidate.examples.length).toBe(4);
      expect(ConfigValidate.examples[0]).toContain('command.id');
      expect(ConfigValidate.examples[2]).toContain('--schema v2');
    });
  });

  describe('Flags', () => {
    it('should have format flag', () => {
      expect(ConfigValidate.flags.format).toBeDefined();
      expect((ConfigValidate.flags.format as any).options).toEqual(['text', 'json']);
      expect((ConfigValidate.flags.format as any).default).toBe('text');
    });

    it('should have schema flag', () => {
      expect(ConfigValidate.flags.schema).toBeDefined();
      expect((ConfigValidate.flags.schema as any).options).toEqual(['v1', 'v2', 'zod']);
      expect((ConfigValidate.flags.schema as any).default).toBe('zod');
    });

    it('should inherit BratCommand baseFlags', () => {
      expect(ConfigValidate.flags).toHaveProperty('context');
      expect(ConfigValidate.flags).toHaveProperty('verbose');
    });
  });

  describe('Command Metadata', () => {
    it('should be properly configured for oclif', () => {
      // Verify oclif can instantiate the command
      const command = new ConfigValidate([], {} as any);
      expect(command).toBeInstanceOf(ConfigValidate);
      expect(command).toBeInstanceOf(BratCommand);
    });
  });
});

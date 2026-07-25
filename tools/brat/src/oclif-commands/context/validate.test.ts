/**
 * oclif Command Tests: context validate
 * Sprint 360: CTX-004
 *
 * NOTE: Smoke tests only. Comprehensive testing with business logic mocks
 * deferred to Phase 4. See sprint-360 shared-business-logic-analysis.md
 * for testing strategy rationale.
 *
 * Business logic is tested separately in:
 * - validateContext (business/context-validation.ts) - 21 tests
 * - formatValidationResults (business/context-validation.ts)
 */

import ContextValidate from './validate';
import { BratCommand } from '../base';

describe('oclif Command: context validate (Smoke Tests)', () => {
  describe('Class Structure', () => {
    it('should extend BratCommand', () => {
      expect(ContextValidate.prototype).toBeInstanceOf(BratCommand);
    });

    it('should have description', () => {
      expect(ContextValidate.description).toBe('Validate execution context configuration');
    });

    it('should have examples', () => {
      expect(ContextValidate.examples).toBeDefined();
      expect(ContextValidate.examples.length).toBe(3);
      expect(ContextValidate.examples[0]).toContain('command.id');
    });
  });

  describe('Arguments', () => {
    it('should have name argument', () => {
      expect(ContextValidate.args.name).toBeDefined();
      expect((ContextValidate.args.name as any).description).toContain('Context name');
      expect((ContextValidate.args.name as any).required).toBe(true);
    });
  });

  describe('Flags', () => {
    it('should have format flag', () => {
      expect(ContextValidate.flags.format).toBeDefined();
      expect((ContextValidate.flags.format as any).options).toEqual(['text', 'json']);
      expect((ContextValidate.flags.format as any).default).toBe('text');
    });

    it('should inherit BratCommand baseFlags', () => {
      expect(ContextValidate.flags).toHaveProperty('context');
      expect(ContextValidate.flags).toHaveProperty('verbose');
    });
  });

  describe('Command Metadata', () => {
    it('should be properly configured for oclif', () => {
      // Verify oclif can instantiate the command
      const command = new ContextValidate([], {} as any);
      expect(command).toBeInstanceOf(ContextValidate);
      expect(command).toBeInstanceOf(BratCommand);
    });
  });
});

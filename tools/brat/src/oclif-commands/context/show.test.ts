/**
 * oclif Command Tests: context show
 * Sprint 360: CTX-002
 *
 * NOTE: Smoke tests only. Comprehensive testing with business logic mocks
 * deferred to Phase 4. See sprint-360 shared-business-logic-analysis.md
 * for testing strategy rationale.
 *
 * Business logic is tested separately in:
 * - ContextResolver (context-resolver.test.ts)
 * - redactSensitiveValues (redaction.test.ts)
 */

import ContextShow from './show';
import { BratCommand } from '../base';

describe('oclif Command: context show (Smoke Tests)', () => {
  describe('Class Structure', () => {
    it('should extend BratCommand', () => {
      expect(ContextShow.prototype).toBeInstanceOf(BratCommand);
    });

    it('should have description', () => {
      expect(ContextShow.description).toBe('Display configuration for an execution context');
    });

    it('should have examples', () => {
      expect(ContextShow.examples).toBeDefined();
      expect(ContextShow.examples.length).toBe(2);
      expect(ContextShow.examples[0]).toContain('command.id');
    });
  });

  describe('Arguments', () => {
    it('should have name argument', () => {
      expect(ContextShow.args.name).toBeDefined();
      expect((ContextShow.args.name as any).description).toBe('Context name to display');
      expect((ContextShow.args.name as any).required).toBe(true);
    });
  });

  describe('Flags', () => {
    it('should have raw flag', () => {
      expect(ContextShow.flags.raw).toBeDefined();
      expect((ContextShow.flags.raw as any).description).toContain('unredacted');
      expect((ContextShow.flags.raw as any).default).toBe(false);
    });

    it('should inherit BratCommand baseFlags', () => {
      expect(ContextShow.flags).toHaveProperty('context');
      expect(ContextShow.flags).toHaveProperty('verbose');
    });
  });

  describe('Command Metadata', () => {
    it('should be properly configured for oclif', () => {
      // Verify oclif can instantiate the command
      const command = new ContextShow([], {} as any);
      expect(command).toBeInstanceOf(ContextShow);
      expect(command).toBeInstanceOf(BratCommand);
    });
  });
});

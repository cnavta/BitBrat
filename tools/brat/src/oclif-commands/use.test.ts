/**
 * oclif Command Tests: use
 * Sprint 360: CTX-005
 *
 * NOTE: Smoke tests only. Comprehensive testing with business logic mocks
 * deferred to Phase 4. See sprint-360 shared-business-logic-analysis.md
 * for testing strategy rationale.
 *
 * Business logic is tested separately in:
 * - executeUse (commands/use.ts)
 * - ContextResolver (context-resolver.test.ts)
 * - setCurrentContext, getCurrentContext (bratrc.test.ts)
 */

import Use from './use';
import { BratCommand } from './base';

describe('oclif Command: use (Smoke Tests)', () => {
  describe('Class Structure', () => {
    it('should extend BratCommand', () => {
      expect(Use.prototype).toBeInstanceOf(BratCommand);
    });

    it('should have description', () => {
      expect(Use.description).toBe('Switch to a different execution context');
    });

    it('should have examples', () => {
      expect(Use.examples).toBeDefined();
      expect(Use.examples.length).toBe(3);
      expect(Use.examples[0]).toContain('command.id');
    });
  });

  describe('Arguments', () => {
    it('should have context argument', () => {
      expect(Use.args.context).toBeDefined();
      expect((Use.args.context as any).description).toContain('Context name');
      expect((Use.args.context as any).required).toBe(true);
    });
  });

  describe('Command Metadata', () => {
    it('should be properly configured for oclif', () => {
      // Verify oclif can instantiate the command
      const command = new Use([], {} as any);
      expect(command).toBeInstanceOf(Use);
      expect(command).toBeInstanceOf(BratCommand);
    });
  });
});

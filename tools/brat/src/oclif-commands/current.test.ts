/**
 * oclif Command Tests: current
 * Sprint 360: CTX-006
 *
 * NOTE: Smoke tests only. Comprehensive testing with business logic mocks
 * deferred to Phase 4. See sprint-360 shared-business-logic-analysis.md
 * for testing strategy rationale.
 *
 * Business logic is tested separately in:
 * - executeCurrent (commands/current.ts)
 * - getCurrentContext (bratrc.test.ts)
 */

import Current from './current';
import { BratCommand } from './base';

describe('oclif Command: current (Smoke Tests)', () => {
  describe('Class Structure', () => {
    it('should extend BratCommand', () => {
      expect(Current.prototype).toBeInstanceOf(BratCommand);
    });

    it('should have description', () => {
      expect(Current.description).toBe('Show the current execution context');
    });

    it('should have examples', () => {
      expect(Current.examples).toBeDefined();
      expect(Current.examples.length).toBe(1);
      expect(Current.examples[0]).toContain('command.id');
    });
  });

  describe('Command Metadata', () => {
    it('should be properly configured for oclif', () => {
      // Verify oclif can instantiate the command
      const command = new Current([], {} as any);
      expect(command).toBeInstanceOf(Current);
      expect(command).toBeInstanceOf(BratCommand);
    });
  });
});

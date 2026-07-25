/**
 * oclif Command Tests: context list
 * Sprint 360: CTX-001
 *
 * NOTE: Smoke tests only. Comprehensive testing with business logic mocks
 * deferred to Phase 4. See sprint-360 shared-business-logic-analysis.md
 * for testing strategy rationale.
 *
 * Business logic is tested separately in:
 * - ContextResolver (context-resolver.test.ts)
 * - getCurrentContext (bratrc.test.ts)
 */

import ContextList from './list';
import { BratCommand } from '../base';

describe('oclif Command: context list (Smoke Tests)', () => {
  describe('Class Structure', () => {
    it('should extend BratCommand', () => {
      expect(ContextList.prototype).toBeInstanceOf(BratCommand);
    });

    it('should have description', () => {
      expect(ContextList.description).toBe('List all execution contexts');
    });

    it('should have examples', () => {
      expect(ContextList.examples).toBeDefined();
      expect(ContextList.examples.length).toBe(3);
      // Examples use oclif template strings (e.g., <%= config.bin %>) that don't interpolate in tests
      expect(ContextList.examples[0]).toContain('command.id');
    });
  });

  describe('Flags', () => {
    it('should have format flag', () => {
      expect(ContextList.flags.format).toBeDefined();
      expect((ContextList.flags.format as any).options).toEqual(['table', 'json', 'yaml']);
      expect((ContextList.flags.format as any).default).toBe('table');
      expect((ContextList.flags.format as any).description).toBe('Output format');
    });

    it('should inherit BratCommand baseFlags', () => {
      expect(ContextList.flags).toHaveProperty('context');
      expect(ContextList.flags).toHaveProperty('verbose');
    });
  });

  describe('Command Metadata', () => {
    it('should be properly configured for oclif', () => {
      // Verify oclif can instantiate the command
      const command = new ContextList([], {} as any);
      expect(command).toBeInstanceOf(ContextList);
      expect(command).toBeInstanceOf(BratCommand);
    });
  });
});

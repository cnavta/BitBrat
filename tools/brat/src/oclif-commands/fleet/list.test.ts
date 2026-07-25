/**
 * oclif Command Tests: fleet list
 * Sprint 360: FLT-001
 *
 * NOTE: Smoke tests only. Comprehensive testing with business logic mocks
 * deferred to Phase 4. See sprint-360 shared-business-logic-analysis.md
 * for testing strategy rationale.
 *
 * Business logic is tested separately in:
 * - FleetCommand base class (fleet-command.test.ts) - 9 smoke tests
 * - fleet-dispatcher (fleet-dispatcher.test.ts) - 28 tests
 * - registry-resolver (registry-resolver.test.ts) - 28 tests
 * - gateway-resolver (gateway-resolver.test.ts) - 27 tests
 * - fleet-helpers (fleet-helpers.test.ts) - 39 tests
 */

import FleetList from './list';
import { FleetCommand } from '../fleet-command';

describe('oclif Command: fleet list (Smoke Tests)', () => {
  describe('Class Structure', () => {
    it('should extend FleetCommand', () => {
      expect(FleetList.prototype).toBeInstanceOf(FleetCommand);
    });

    it('should have description', () => {
      expect(FleetList.description).toBe('List all live Bits in the fleet');
    });

    it('should have examples', () => {
      expect(FleetList.examples).toBeDefined();
      expect(FleetList.examples.length).toBe(3);
      expect(FleetList.examples[0]).toContain('command.id');
    });
  });

  describe('Flags', () => {
    it('should inherit FleetCommand baseFlags', () => {
      expect(FleetList.flags).toHaveProperty('all');
      expect(FleetList.flags).toHaveProperty('direct');
      expect(FleetList.flags).toHaveProperty('json');
      expect(FleetList.flags).toHaveProperty('confirm');
      expect(FleetList.flags).toHaveProperty('roles');
      expect(FleetList.flags).toHaveProperty('context');
      expect(FleetList.flags).toHaveProperty('verbose');
    });
  });

  describe('Subcommand', () => {
    it('should define list subcommand', () => {
      const command = new FleetList([], {} as any);
      expect(command['subcommand']).toBe('list');
    });
  });

  describe('Command Metadata', () => {
    it('should be properly configured for oclif', () => {
      // Verify oclif can instantiate the command
      const command = new FleetList([], {} as any);
      expect(command).toBeInstanceOf(FleetList);
      expect(command).toBeInstanceOf(FleetCommand);
    });
  });
});

/**
 * oclif Command Tests: fleet info
 * Sprint 360: FLT-002
 */

import FleetInfo from './info';
import { FleetCommand } from '../fleet-command';

describe('oclif Command: fleet info (Smoke Tests)', () => {
  describe('Class Structure', () => {
    it('should extend FleetCommand', () => {
      expect(FleetInfo.prototype).toBeInstanceOf(FleetCommand);
    });

    it('should have description', () => {
      expect(FleetInfo.description).toBe('Get bit.info from Bit(s)');
    });
  });

  describe('Arguments', () => {
    it('should have optional bit argument', () => {
      expect(FleetInfo.args.bit).toBeDefined();
      expect((FleetInfo.args.bit as any).required).toBe(false);
    });
  });

  describe('Subcommand', () => {
    it('should define info subcommand', () => {
      const command = new FleetInfo([], {} as any);
      expect(command['subcommand']).toBe('info');
    });
  });
});

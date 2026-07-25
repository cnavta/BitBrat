/**
 * FleetCommand Base Class Tests
 * Sprint 360: Smoke tests for fleet-command.ts
 *
 * NOTE: Comprehensive testing deferred to actual command tests in Phase 2.
 * The FleetCommand base class is primarily an orchestration layer that delegates
 * to business logic modules (all tested with 193 tests in Phase 0).
 *
 * End-to-end testing will occur when we migrate actual fleet commands.
 */

import { FleetCommand } from './fleet-command';
import { BratCommand } from './base';
import { createDefaultFleetDeps, mergeFleetDeps } from '../business/fleet-deps';

// Concrete test command for smoke tests
class TestFleetCommand extends FleetCommand {
  static description = 'Test fleet command';

  protected get subcommand(): string {
    return 'list';
  }
}

describe('FleetCommand Base Class (Smoke Tests)', () => {
  describe('Class Structure', () => {
    it('should extend BratCommand', () => {
      expect(TestFleetCommand.prototype).toBeInstanceOf(BratCommand);
    });

    it('should have baseFlags defined', () => {
      expect(FleetCommand.baseFlags).toBeDefined();
      expect(FleetCommand.baseFlags).toHaveProperty('all');
      expect(FleetCommand.baseFlags).toHaveProperty('direct');
      expect(FleetCommand.baseFlags).toHaveProperty('json');
      expect(FleetCommand.baseFlags).toHaveProperty('confirm');
      expect(FleetCommand.baseFlags).toHaveProperty('roles');
      expect(FleetCommand.baseFlags).toHaveProperty('user-id');
      expect(FleetCommand.baseFlags).toHaveProperty('url');
    });

    it('should have legacy flags marked as hidden', () => {
      expect(FleetCommand.baseFlags.target).toBeDefined();
      expect((FleetCommand.baseFlags.target as any).hidden).toBe(true);
      expect(FleetCommand.baseFlags['project-id']).toBeDefined();
      expect((FleetCommand.baseFlags['project-id'] as any).hidden).toBe(true);
    });

    it('should include BratCommand baseFlags', () => {
      expect(FleetCommand.baseFlags).toHaveProperty('context');
      expect(FleetCommand.baseFlags).toHaveProperty('verbose');
    });
  });

  describe('Dependency Injection', () => {
    it('should create default fleet deps', () => {
      const command = new TestFleetCommand([], {} as any);
      expect(command['fleetDeps']).toBeDefined();
      expect(command['fleetDeps'].resolveIdentityFn).toBeDefined();
      expect(command['fleetDeps'].gatewayTransportFactory).toBeDefined();
      expect(command['fleetDeps'].directTransportFactory).toBeDefined();
    });

    it('should allow injecting custom deps', () => {
      const command = new TestFleetCommand([], {} as any);
      const customOut = jest.fn();

      command.injectDeps({ out: customOut });

      expect(command['fleetDeps'].out).toBe(customOut);
    });

    it('should merge injected deps with defaults', () => {
      const command = new TestFleetCommand([], {} as any);
      const customOut = jest.fn();

      command.injectDeps({ out: customOut });

      // Custom dep present
      expect(command['fleetDeps'].out).toBe(customOut);

      // Default deps still present
      expect(command['fleetDeps'].resolveIdentityFn).toBeDefined();
      expect(command['fleetDeps'].gatewayTransportFactory).toBeDefined();
    });
  });

  describe('Subcommand Interface', () => {
    it('should require subclass to implement subcommand getter', () => {
      const command = new TestFleetCommand([], {} as any);
      expect(command['subcommand']).toBe('list');
    });
  });

  describe('Flag Descriptions', () => {
    it('should have descriptive help text for all flags', () => {
      const { all, direct, json, confirm, roles } = FleetCommand.baseFlags;

      expect(all.description).toContain('all Bits');
      expect(direct.description).toContain('Break-glass');
      expect(json.description).toContain('JSON');
      expect(confirm.description).toContain('high-blast-radius');
      expect(roles.description).toContain('MCP roles');
    });
  });
});

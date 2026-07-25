/**
 * oclif Command Tests: context create
 * Sprint 360: CTX-003
 *
 * NOTE: Smoke tests only. Comprehensive testing with business logic mocks
 * deferred to Phase 4. See sprint-360 shared-business-logic-analysis.md
 * for testing strategy rationale.
 *
 * Business logic is tested separately in:
 * - executeContextCreate (commands/context/create.ts)
 * - scaffoldEnvironment, buildInteractive, buildNonInteractive helpers
 */

import ContextCreate from './create';
import { BratCommand } from '../base';

describe('oclif Command: context create (Smoke Tests)', () => {
  describe('Class Structure', () => {
    it('should extend BratCommand', () => {
      expect(ContextCreate.prototype).toBeInstanceOf(BratCommand);
    });

    it('should have description', () => {
      expect(ContextCreate.description).toBe('Create a new execution context');
    });

    it('should have examples', () => {
      expect(ContextCreate.examples).toBeDefined();
      expect(ContextCreate.examples.length).toBeGreaterThan(0);
      expect(ContextCreate.examples[0]).toContain('command.id');
    });
  });

  describe('Arguments', () => {
    it('should have name argument', () => {
      expect(ContextCreate.args.name).toBeDefined();
      expect((ContextCreate.args.name as any).description).toContain('Context name');
      expect((ContextCreate.args.name as any).required).toBe(true);
    });
  });

  describe('Flags', () => {
    it('should have non-interactive flag', () => {
      expect(ContextCreate.flags['non-interactive']).toBeDefined();
      expect((ContextCreate.flags['non-interactive'] as any).description).toContain('Non-interactive');
      expect((ContextCreate.flags['non-interactive'] as any).default).toBe(false);
    });

    it('should have deployment type flag', () => {
      expect(ContextCreate.flags.type).toBeDefined();
      expect((ContextCreate.flags.type as any).options).toEqual(['docker-compose', 'cloud-run', 'k8s']);
    });

    it('should have persistence driver flag', () => {
      expect(ContextCreate.flags['persistence-driver']).toBeDefined();
      expect((ContextCreate.flags['persistence-driver'] as any).options).toEqual(['postgres', 'firestore']);
    });

    it('should have PostgreSQL configuration flags', () => {
      expect(ContextCreate.flags['pg-host']).toBeDefined();
      expect(ContextCreate.flags['pg-port']).toBeDefined();
      expect(ContextCreate.flags['pg-database']).toBeDefined();
      expect(ContextCreate.flags['pg-username']).toBeDefined();
      expect(ContextCreate.flags['pg-password']).toBeDefined();
      expect((ContextCreate.flags['pg-port'] as any).default).toBe(5432);
    });

    it('should have Docker configuration flags', () => {
      expect(ContextCreate.flags['docker-host']).toBeDefined();
      expect(ContextCreate.flags['docker-remote-dir']).toBeDefined();
    });

    it('should have GCP configuration flags', () => {
      expect(ContextCreate.flags['gcp-project']).toBeDefined();
      expect(ContextCreate.flags['gcp-region']).toBeDefined();
    });

    it('should have gateway configuration flags', () => {
      expect(ContextCreate.flags['gateway-url']).toBeDefined();
      expect(ContextCreate.flags['gateway-auth-token']).toBeDefined();
    });

    it('should have environment configuration flags', () => {
      expect(ContextCreate.flags['env-path']).toBeDefined();
      expect(ContextCreate.flags.description).toBeDefined();
      expect(ContextCreate.flags.tags).toBeDefined();
    });

    it('should inherit BratCommand baseFlags', () => {
      expect(ContextCreate.flags).toHaveProperty('context');
      expect(ContextCreate.flags).toHaveProperty('verbose');
    });
  });

  describe('Command Metadata', () => {
    it('should be properly configured for oclif', () => {
      // Verify oclif can instantiate the command
      const command = new ContextCreate([], {} as any);
      expect(command).toBeInstanceOf(ContextCreate);
      expect(command).toBeInstanceOf(BratCommand);
    });
  });
});

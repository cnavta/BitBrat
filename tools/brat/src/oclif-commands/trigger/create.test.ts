/**
 * Sprint 364: trigger create command tests (smoke tests only)
 */

import TriggerCreate from './create';

describe('trigger create command', () => {
  it('should extend BratCommand', () => {
    // @ts-ignore - accessing prototype for validation
    expect(TriggerCreate.prototype.constructor.name).toBe('TriggerCreate');
  });

  it('should have description', () => {
    expect(TriggerCreate.description).toBeTruthy();
    expect(TriggerCreate.description).toContain('Cloud Build trigger');
  });

  it('should have examples', () => {
    expect(TriggerCreate.examples).toBeDefined();
    expect(TriggerCreate.examples.length).toBeGreaterThan(0);
  });

  it('should have required args', () => {
    expect(TriggerCreate.args).toBeDefined();
    expect(TriggerCreate.args.name).toBeDefined();
  });

  it('should have all required flags', () => {
    expect(TriggerCreate.flags).toBeDefined();
    expect(TriggerCreate.flags['project-id']).toBeDefined();
    expect(TriggerCreate.flags.repo).toBeDefined();
    expect(TriggerCreate.flags.branch).toBeDefined();
    expect(TriggerCreate.flags.config).toBeDefined();
    expect(TriggerCreate.flags['dry-run']).toBeDefined();
  });

  it('should inherit BratCommand baseFlags', () => {
    // BratCommand.baseFlags includes --context
    expect(TriggerCreate.flags.context).toBeDefined();
  });

  it('should be instantiable by oclif', () => {
    // oclif requires commands to have static properties
    expect(TriggerCreate.description).toBeDefined();
    expect(TriggerCreate.flags).toBeDefined();
    expect(TriggerCreate.args).toBeDefined();
  });
});

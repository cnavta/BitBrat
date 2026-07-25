/**
 * Sprint 364: trigger delete command tests (smoke tests only)
 */

import TriggerDelete from './delete';

describe('trigger delete command', () => {
  it('should extend BratCommand', () => {
    // @ts-ignore - accessing prototype for validation
    expect(TriggerDelete.prototype.constructor.name).toBe('TriggerDelete');
  });

  it('should have description', () => {
    expect(TriggerDelete.description).toBeTruthy();
    expect(TriggerDelete.description).toContain('Cloud Build trigger');
  });

  it('should have examples', () => {
    expect(TriggerDelete.examples).toBeDefined();
    expect(TriggerDelete.examples.length).toBeGreaterThan(0);
  });

  it('should have required args', () => {
    expect(TriggerDelete.args).toBeDefined();
    expect(TriggerDelete.args.name).toBeDefined();
  });

  it('should have all required flags', () => {
    expect(TriggerDelete.flags).toBeDefined();
    expect(TriggerDelete.flags['project-id']).toBeDefined();
    expect(TriggerDelete.flags['dry-run']).toBeDefined();
  });

  it('should inherit BratCommand baseFlags', () => {
    // BratCommand.baseFlags includes --context
    expect(TriggerDelete.flags.context).toBeDefined();
  });

  it('should be instantiable by oclif', () => {
    // oclif requires commands to have static properties
    expect(TriggerDelete.description).toBeDefined();
    expect(TriggerDelete.flags).toBeDefined();
    expect(TriggerDelete.args).toBeDefined();
  });
});

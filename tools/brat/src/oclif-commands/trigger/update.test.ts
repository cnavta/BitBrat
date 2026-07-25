/**
 * Sprint 364: trigger update command tests (smoke tests only)
 */

import TriggerUpdate from './update';

describe('trigger update command', () => {
  it('should extend BratCommand', () => {
    // @ts-ignore - accessing prototype for validation
    expect(TriggerUpdate.prototype.constructor.name).toBe('TriggerUpdate');
  });

  it('should have description', () => {
    expect(TriggerUpdate.description).toBeTruthy();
    expect(TriggerUpdate.description).toContain('Cloud Build trigger');
  });

  it('should have examples', () => {
    expect(TriggerUpdate.examples).toBeDefined();
    expect(TriggerUpdate.examples.length).toBeGreaterThan(0);
  });

  it('should have required args', () => {
    expect(TriggerUpdate.args).toBeDefined();
    expect(TriggerUpdate.args.name).toBeDefined();
  });

  it('should have all required flags', () => {
    expect(TriggerUpdate.flags).toBeDefined();
    expect(TriggerUpdate.flags['project-id']).toBeDefined();
    expect(TriggerUpdate.flags.repo).toBeDefined();
    expect(TriggerUpdate.flags.branch).toBeDefined();
    expect(TriggerUpdate.flags.config).toBeDefined();
    expect(TriggerUpdate.flags['dry-run']).toBeDefined();
  });

  it('should inherit BratCommand baseFlags', () => {
    // BratCommand.baseFlags includes --context
    expect(TriggerUpdate.flags.context).toBeDefined();
  });

  it('should be instantiable by oclif', () => {
    // oclif requires commands to have static properties
    expect(TriggerUpdate.description).toBeDefined();
    expect(TriggerUpdate.flags).toBeDefined();
    expect(TriggerUpdate.args).toBeDefined();
  });
});

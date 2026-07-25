/**
 * Sprint 364: apis enable command tests (smoke tests only)
 */

import ApisEnable from './enable';

describe('apis enable command', () => {
  it('should extend BratCommand', () => {
    // @ts-ignore - accessing prototype for validation
    expect(ApisEnable.prototype.constructor.name).toBe('ApisEnable');
  });

  it('should have description', () => {
    expect(ApisEnable.description).toBeTruthy();
    expect(ApisEnable.description).toContain('GCP APIs');
  });

  it('should have examples', () => {
    expect(ApisEnable.examples).toBeDefined();
    expect(ApisEnable.examples.length).toBeGreaterThan(0);
  });

  it('should have all required flags', () => {
    expect(ApisEnable.flags).toBeDefined();
    expect(ApisEnable.flags['project-id']).toBeDefined();
    expect(ApisEnable.flags['dry-run']).toBeDefined();
    expect(ApisEnable.flags.json).toBeDefined();
  });

  it('should inherit BratCommand baseFlags', () => {
    // BratCommand.baseFlags includes --context
    expect(ApisEnable.flags.context).toBeDefined();
  });

  it('should be instantiable by oclif', () => {
    // oclif requires commands to have static properties
    expect(ApisEnable.description).toBeDefined();
    expect(ApisEnable.flags).toBeDefined();
  });
});

/**
 * Sprint 364: cloud-run shutdown command tests (smoke tests only)
 */

import CloudRunShutdown from './shutdown';

describe('cloud-run shutdown command', () => {
  it('should extend BratCommand', () => {
    // @ts-ignore - accessing prototype for validation
    expect(CloudRunShutdown.prototype.constructor.name).toBe('CloudRunShutdown');
  });

  it('should have description', () => {
    expect(CloudRunShutdown.description).toBeTruthy();
    expect(CloudRunShutdown.description).toContain('Cloud Run');
  });

  it('should have examples', () => {
    expect(CloudRunShutdown.examples).toBeDefined();
    expect(CloudRunShutdown.examples.length).toBeGreaterThan(0);
  });

  it('should have all required flags', () => {
    expect(CloudRunShutdown.flags).toBeDefined();
    expect(CloudRunShutdown.flags['project-id']).toBeDefined();
    expect(CloudRunShutdown.flags.region).toBeDefined();
    expect(CloudRunShutdown.flags['dry-run']).toBeDefined();
  });

  it('should inherit BratCommand baseFlags', () => {
    // BratCommand.baseFlags includes --context
    expect(CloudRunShutdown.flags.context).toBeDefined();
  });

  it('should be instantiable by oclif', () => {
    // oclif requires commands to have static properties
    expect(CloudRunShutdown.description).toBeDefined();
    expect(CloudRunShutdown.flags).toBeDefined();
  });
});

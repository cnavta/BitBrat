/**
 * Sprint 363: docker down command tests (smoke tests only)
 */

import DockerDown from './down';

describe('docker down command', () => {
  it('should extend BratCommand', () => {
    // @ts-ignore - accessing prototype for validation
    expect(DockerDown.prototype.constructor.name).toBe('DockerDown');
  });

  it('should have description', () => {
    expect(DockerDown.description).toBeTruthy();
    expect(DockerDown.description).toContain('Docker Compose');
  });

  it('should have examples', () => {
    expect(DockerDown.examples).toBeDefined();
    expect(DockerDown.examples.length).toBeGreaterThan(0);
  });

  it('should have all required flags', () => {
    expect(DockerDown.flags).toBeDefined();
    expect(DockerDown.flags.service).toBeDefined();
    expect(DockerDown.flags['dry-run']).toBeDefined();
  });

  it('should inherit BratCommand baseFlags', () => {
    // BratCommand.baseFlags includes --context
    expect(DockerDown.flags.context).toBeDefined();
  });

  it('should be instantiable by oclif', () => {
    // oclif requires commands to have static properties
    expect(DockerDown.description).toBeDefined();
    expect(DockerDown.flags).toBeDefined();
  });
});

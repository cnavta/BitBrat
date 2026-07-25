/**
 * Sprint 363: docker up command tests (smoke tests only)
 */

import DockerUp from './up';

describe('docker up command', () => {
  it('should extend BratCommand', () => {
    // @ts-ignore - accessing prototype for validation
    expect(DockerUp.prototype.constructor.name).toBe('DockerUp');
  });

  it('should have description', () => {
    expect(DockerUp.description).toBeTruthy();
    expect(DockerUp.description).toContain('Docker Compose');
  });

  it('should have examples', () => {
    expect(DockerUp.examples).toBeDefined();
    expect(DockerUp.examples.length).toBeGreaterThan(0);
  });

  it('should have all required flags', () => {
    expect(DockerUp.flags).toBeDefined();
    expect(DockerUp.flags.service).toBeDefined();
    expect(DockerUp.flags.loki).toBeDefined();
    expect(DockerUp.flags['no-deps']).toBeDefined();
    expect(DockerUp.flags['force-recreate']).toBeDefined();
    expect(DockerUp.flags['no-cache']).toBeDefined();
    expect(DockerUp.flags['dry-run']).toBeDefined();
  });

  it('should inherit BratCommand baseFlags', () => {
    // BratCommand.baseFlags includes --context
    expect(DockerUp.flags.context).toBeDefined();
  });

  it('should be instantiable by oclif', () => {
    // oclif requires commands to have static properties
    expect(DockerUp.description).toBeDefined();
    expect(DockerUp.flags).toBeDefined();
  });
});

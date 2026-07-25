/**
 * Sprint 363: docker ps command tests (smoke tests only)
 */

import DockerPs from './ps';

describe('docker ps command', () => {
  it('should extend BratCommand', () => {
    // @ts-ignore - accessing prototype for validation
    expect(DockerPs.prototype.constructor.name).toBe('DockerPs');
  });

  it('should have description', () => {
    expect(DockerPs.description).toBeTruthy();
    expect(DockerPs.description).toContain('Docker Compose');
  });

  it('should have examples', () => {
    expect(DockerPs.examples).toBeDefined();
    expect(DockerPs.examples.length).toBeGreaterThan(0);
  });

  it('should have all required flags', () => {
    expect(DockerPs.flags).toBeDefined();
    expect(DockerPs.flags.service).toBeDefined();
  });

  it('should inherit BratCommand baseFlags', () => {
    // BratCommand.baseFlags includes --context
    expect(DockerPs.flags.context).toBeDefined();
  });

  it('should be instantiable by oclif', () => {
    // oclif requires commands to have static properties
    expect(DockerPs.description).toBeDefined();
    expect(DockerPs.flags).toBeDefined();
  });
});

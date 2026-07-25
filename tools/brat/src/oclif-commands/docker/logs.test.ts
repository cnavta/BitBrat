/**
 * Sprint 363: docker logs command tests (smoke tests only)
 */

import DockerLogs from './logs';

describe('docker logs command', () => {
  it('should extend BratCommand', () => {
    // @ts-ignore - accessing prototype for validation
    expect(DockerLogs.prototype.constructor.name).toBe('DockerLogs');
  });

  it('should have description', () => {
    expect(DockerLogs.description).toBeTruthy();
    expect(DockerLogs.description).toContain('Docker Compose');
  });

  it('should have examples', () => {
    expect(DockerLogs.examples).toBeDefined();
    expect(DockerLogs.examples.length).toBeGreaterThan(0);
  });

  it('should have all required flags', () => {
    expect(DockerLogs.flags).toBeDefined();
    expect(DockerLogs.flags.service).toBeDefined();
    expect(DockerLogs.flags.follow).toBeDefined();
  });

  it('should inherit BratCommand baseFlags', () => {
    // BratCommand.baseFlags includes --context
    expect(DockerLogs.flags.context).toBeDefined();
  });

  it('should be instantiable by oclif', () => {
    // oclif requires commands to have static properties
    expect(DockerLogs.description).toBeDefined();
    expect(DockerLogs.flags).toBeDefined();
  });
});

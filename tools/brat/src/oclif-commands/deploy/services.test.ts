/**
 * Smoke tests for brat deploy services command
 * Sprint 362
 */

import DeployServices from './services';
import { BratCommand } from '../base';

describe('deploy services command', () => {
  it('should extend BratCommand', () => {
    expect(Object.getPrototypeOf(DeployServices)).toBe(BratCommand);
  });

  it('should have description', () => {
    expect(DeployServices.description).toBeTruthy();
    expect(typeof DeployServices.description).toBe('string');
  });

  it('should have examples', () => {
    expect(DeployServices.examples).toBeDefined();
    expect(Array.isArray(DeployServices.examples)).toBe(true);
    expect(DeployServices.examples.length).toBeGreaterThan(0);
  });

  it('should have all required flags', () => {
    expect(DeployServices.flags).toHaveProperty('project-id');
    expect(DeployServices.flags).toHaveProperty('region');
    expect(DeployServices.flags).toHaveProperty('dry-run');
    expect(DeployServices.flags).toHaveProperty('concurrency');
    expect(DeployServices.flags).toHaveProperty('allow-no-vpc');
    expect(DeployServices.flags).toHaveProperty('image-tag');
    expect(DeployServices.flags).toHaveProperty('repo');
  });

  it('should inherit BratCommand baseFlags', () => {
    expect(DeployServices.flags).toHaveProperty('verbose');
    expect(DeployServices.flags).toHaveProperty('context');
  });

  it('should be instantiable by oclif', () => {
    expect(() => {
      // @ts-ignore - oclif will handle instantiation
      new DeployServices([], {} as any);
    }).not.toThrow();
  });
});

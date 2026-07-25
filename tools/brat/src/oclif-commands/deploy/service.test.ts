/**
 * Smoke tests for brat deploy service command
 * Sprint 362
 */

import DeployService from './service';
import { BratCommand } from '../base';

describe('deploy service command', () => {
  it('should extend BratCommand', () => {
    expect(Object.getPrototypeOf(DeployService)).toBe(BratCommand);
  });

  it('should have description', () => {
    expect(DeployService.description).toBeTruthy();
    expect(typeof DeployService.description).toBe('string');
  });

  it('should have examples', () => {
    expect(DeployService.examples).toBeDefined();
    expect(Array.isArray(DeployService.examples)).toBe(true);
    expect(DeployService.examples.length).toBeGreaterThan(0);
  });

  it('should have name arg', () => {
    expect(DeployService.args).toBeDefined();
    expect(DeployService.args).toHaveProperty('name');
  });

  it('should have all required flags', () => {
    expect(DeployService.flags).toHaveProperty('project-id');
    expect(DeployService.flags).toHaveProperty('region');
    expect(DeployService.flags).toHaveProperty('dry-run');
    expect(DeployService.flags).toHaveProperty('allow-no-vpc');
    expect(DeployService.flags).toHaveProperty('image-tag');
    expect(DeployService.flags).toHaveProperty('repo');
  });

  it('should inherit BratCommand baseFlags', () => {
    expect(DeployService.flags).toHaveProperty('verbose');
    expect(DeployService.flags).toHaveProperty('context');
  });

  it('should be instantiable by oclif', () => {
    expect(() => {
      // @ts-ignore - oclif will handle instantiation
      new DeployService([], {} as any);
    }).not.toThrow();
  });
});

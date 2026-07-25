/**
 * Smoke tests for brat infra apply command
 * Sprint 362
 */

import InfraApply from './apply';
import { BratCommand } from '../base';

describe('infra apply command', () => {
  it('should extend BratCommand', () => {
    expect(Object.getPrototypeOf(InfraApply)).toBe(BratCommand);
  });

  it('should have description', () => {
    expect(InfraApply.description).toBeTruthy();
    expect(typeof InfraApply.description).toBe('string');
  });

  it('should have examples', () => {
    expect(InfraApply.examples).toBeDefined();
    expect(Array.isArray(InfraApply.examples)).toBe(true);
    expect(InfraApply.examples.length).toBeGreaterThan(0);
  });

  it('should have module arg', () => {
    expect(InfraApply.args).toBeDefined();
    expect(InfraApply.args).toHaveProperty('module');
  });

  it('should have all required flags', () => {
    expect(InfraApply.flags).toHaveProperty('project-id');
    expect(InfraApply.flags).toHaveProperty('region');
    expect(InfraApply.flags).toHaveProperty('module');
    expect(InfraApply.flags).toHaveProperty('dry-run');
  });

  it('should inherit BratCommand baseFlags', () => {
    expect(InfraApply.flags).toHaveProperty('verbose');
    expect(InfraApply.flags).toHaveProperty('context');
  });

  it('should be instantiable by oclif', () => {
    expect(() => {
      // @ts-ignore - oclif will handle instantiation
      new InfraApply([], {} as any);
    }).not.toThrow();
  });
});

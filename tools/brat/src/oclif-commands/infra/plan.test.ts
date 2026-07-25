/**
 * Smoke tests for brat infra plan command
 * Sprint 362
 */

import InfraPlan from './plan';
import { BratCommand } from '../base';

describe('infra plan command', () => {
  it('should extend BratCommand', () => {
    expect(Object.getPrototypeOf(InfraPlan)).toBe(BratCommand);
  });

  it('should have description', () => {
    expect(InfraPlan.description).toBeTruthy();
    expect(typeof InfraPlan.description).toBe('string');
  });

  it('should have examples', () => {
    expect(InfraPlan.examples).toBeDefined();
    expect(Array.isArray(InfraPlan.examples)).toBe(true);
    expect(InfraPlan.examples.length).toBeGreaterThan(0);
  });

  it('should have module arg', () => {
    expect(InfraPlan.args).toBeDefined();
    expect(InfraPlan.args).toHaveProperty('module');
  });

  it('should have all required flags', () => {
    expect(InfraPlan.flags).toHaveProperty('project-id');
    expect(InfraPlan.flags).toHaveProperty('region');
    expect(InfraPlan.flags).toHaveProperty('module');
  });

  it('should inherit BratCommand baseFlags', () => {
    expect(InfraPlan.flags).toHaveProperty('verbose');
    expect(InfraPlan.flags).toHaveProperty('context');
  });

  it('should be instantiable by oclif', () => {
    expect(() => {
      // @ts-ignore - oclif will handle instantiation
      new InfraPlan([], {} as any);
    }).not.toThrow();
  });
});

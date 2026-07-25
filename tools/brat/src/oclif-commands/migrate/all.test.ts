/**
 * Smoke tests for brat migrate:all command
 * Sprint 361
 */

import MigrateAll from './all';
import { BratCommand } from '../base';

describe('migrate:all command', () => {
  it('should extend BratCommand', () => {
    expect(Object.getPrototypeOf(MigrateAll)).toBe(BratCommand);
  });

  it('should have description', () => {
    expect(MigrateAll.description).toBeTruthy();
    expect(typeof MigrateAll.description).toBe('string');
  });

  it('should have examples', () => {
    expect(MigrateAll.examples).toBeDefined();
    expect(Array.isArray(MigrateAll.examples)).toBe(true);
    expect(MigrateAll.examples.length).toBeGreaterThan(0);
  });

  it('should have all required flags', () => {
    expect(MigrateAll.flags).toHaveProperty('dry-run');
    expect(MigrateAll.flags).toHaveProperty('json');
  });

  it('should inherit BratCommand baseFlags', () => {
    expect(MigrateAll.flags).toHaveProperty('verbose');
    expect(MigrateAll.flags).toHaveProperty('context');
  });

  it('should be instantiable by oclif', () => {
    expect(() => {
      // @ts-ignore - oclif will handle instantiation
      new MigrateAll([], {} as any);
    }).not.toThrow();
  });
});

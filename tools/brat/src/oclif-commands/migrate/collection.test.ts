/**
 * Smoke tests for brat migrate:collection command
 * Sprint 361
 */

import MigrateCollection from './collection';
import { BratCommand } from '../base';

describe('migrate:collection command', () => {
  it('should extend BratCommand', () => {
    expect(Object.getPrototypeOf(MigrateCollection)).toBe(BratCommand);
  });

  it('should have description', () => {
    expect(MigrateCollection.description).toBeTruthy();
    expect(typeof MigrateCollection.description).toBe('string');
  });

  it('should have examples', () => {
    expect(MigrateCollection.examples).toBeDefined();
    expect(Array.isArray(MigrateCollection.examples)).toBe(true);
    expect(MigrateCollection.examples.length).toBeGreaterThan(0);
  });

  it('should have collection arg', () => {
    expect(MigrateCollection.args).toBeDefined();
    expect(MigrateCollection.args).toHaveProperty('collection');
  });

  it('should have all required flags', () => {
    expect(MigrateCollection.flags).toHaveProperty('dry-run');
    expect(MigrateCollection.flags).toHaveProperty('json');
  });

  it('should inherit BratCommand baseFlags', () => {
    expect(MigrateCollection.flags).toHaveProperty('verbose');
    expect(MigrateCollection.flags).toHaveProperty('context');
  });

  it('should be instantiable by oclif', () => {
    expect(() => {
      // @ts-ignore - oclif will handle instantiation
      new MigrateCollection([], {} as any);
    }).not.toThrow();
  });
});

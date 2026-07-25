/**
 * Smoke tests for brat db:validate command
 * Sprint 361
 */

import DbValidate from './validate';
import { BratCommand } from '../base';

describe('db:validate command', () => {
  it('should extend BratCommand', () => {
    expect(Object.getPrototypeOf(DbValidate)).toBe(BratCommand);
  });

  it('should have description', () => {
    expect(DbValidate.description).toBeTruthy();
    expect(typeof DbValidate.description).toBe('string');
  });

  it('should have examples', () => {
    expect(DbValidate.examples).toBeDefined();
    expect(Array.isArray(DbValidate.examples)).toBe(true);
    expect(DbValidate.examples.length).toBeGreaterThan(0);
  });

  it('should have collection arg', () => {
    expect(DbValidate.args).toBeDefined();
    expect(DbValidate.args).toHaveProperty('collection');
  });

  it('should have all required flags', () => {
    expect(DbValidate.flags).toHaveProperty('all');
    expect(DbValidate.flags).toHaveProperty('sample-size');
    expect(DbValidate.flags).toHaveProperty('json');
  });

  it('should default sample-size to 1000', () => {
    expect(DbValidate.flags['sample-size'].default).toBe(1000);
  });

  it('should inherit BratCommand baseFlags', () => {
    expect(DbValidate.flags).toHaveProperty('verbose');
    expect(DbValidate.flags).toHaveProperty('context');
  });

  it('should be instantiable by oclif', () => {
    expect(() => {
      // @ts-ignore - oclif will handle instantiation
      new DbValidate([], {} as any);
    }).not.toThrow();
  });
});

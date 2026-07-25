/**
 * Smoke tests for brat pg:restore command
 * Sprint 361
 */

import PgRestore from './restore';
import { BratCommand } from '../base';

describe('pg:restore command', () => {
  it('should extend BratCommand', () => {
    expect(Object.getPrototypeOf(PgRestore)).toBe(BratCommand);
  });

  it('should have description', () => {
    expect(PgRestore.description).toBeTruthy();
    expect(typeof PgRestore.description).toBe('string');
  });

  it('should have examples', () => {
    expect(PgRestore.examples).toBeDefined();
    expect(Array.isArray(PgRestore.examples)).toBe(true);
    expect(PgRestore.examples.length).toBeGreaterThan(0);
  });

  it('should have all required flags', () => {
    expect(PgRestore.flags).toHaveProperty('in');
    expect(PgRestore.flags).toHaveProperty('dry-run');
  });

  it('should require --in flag', () => {
    expect(PgRestore.flags.in.required).toBe(true);
  });

  it('should default to dry-run mode', () => {
    expect(PgRestore.flags['dry-run'].default).toBe(true);
  });

  it('should inherit BratCommand baseFlags', () => {
    expect(PgRestore.flags).toHaveProperty('verbose');
    expect(PgRestore.flags).toHaveProperty('context');
  });

  it('should be instantiable by oclif', () => {
    expect(() => {
      // @ts-ignore - oclif will handle instantiation
      new PgRestore([], {} as any);
    }).not.toThrow();
  });
});

/**
 * Smoke tests for brat pg:backup command
 * Sprint 361
 */

import PgBackup from './backup';
import { BratCommand } from '../base';

describe('pg:backup command', () => {
  it('should extend BratCommand', () => {
    expect(Object.getPrototypeOf(PgBackup)).toBe(BratCommand);
  });

  it('should have description', () => {
    expect(PgBackup.description).toBeTruthy();
    expect(typeof PgBackup.description).toBe('string');
  });

  it('should have examples', () => {
    expect(PgBackup.examples).toBeDefined();
    expect(Array.isArray(PgBackup.examples)).toBe(true);
    expect(PgBackup.examples.length).toBeGreaterThan(0);
  });

  it('should have all required flags', () => {
    expect(PgBackup.flags).toHaveProperty('out');
    expect(PgBackup.flags).toHaveProperty('format');
    expect(PgBackup.flags).toHaveProperty('collections');
    expect(PgBackup.flags).toHaveProperty('compress');
  });

  it('should require --out flag', () => {
    expect(PgBackup.flags.out.required).toBe(true);
  });

  it('should have format options', () => {
    expect(PgBackup.flags.format.options).toEqual(['json', 'sql']);
    expect(PgBackup.flags.format.default).toBe('json');
  });

  it('should inherit BratCommand baseFlags', () => {
    expect(PgBackup.flags).toHaveProperty('verbose');
    expect(PgBackup.flags).toHaveProperty('context');
  });

  it('should be instantiable by oclif', () => {
    expect(() => {
      // @ts-ignore - oclif will handle instantiation
      new PgBackup([], {} as any);
    }).not.toThrow();
  });
});

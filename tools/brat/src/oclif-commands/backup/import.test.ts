/**
 * Smoke tests for brat backup import command
 * Sprint 361
 */

import BackupImport from './import';
import { BratCommand } from '../base';

describe('backup import command', () => {
  it('should extend BratCommand', () => {
    expect(Object.getPrototypeOf(BackupImport)).toBe(BratCommand);
  });

  it('should have description', () => {
    expect(BackupImport.description).toBeTruthy();
    expect(typeof BackupImport.description).toBe('string');
  });

  it('should have examples', () => {
    expect(BackupImport.examples).toBeDefined();
    expect(Array.isArray(BackupImport.examples)).toBe(true);
    expect(BackupImport.examples.length).toBeGreaterThan(0);
  });

  it('should have all required flags', () => {
    expect(BackupImport.flags).toHaveProperty('in');
    expect(BackupImport.flags).toHaveProperty('project-id');
    expect(BackupImport.flags).toHaveProperty('env');
    expect(BackupImport.flags).toHaveProperty('mode');
    expect(BackupImport.flags).toHaveProperty('collections');
    expect(BackupImport.flags).toHaveProperty('include-secrets');
    expect(BackupImport.flags).toHaveProperty('confirm');
    expect(BackupImport.flags).toHaveProperty('json');
  });

  it('should require --in flag', () => {
    expect(BackupImport.flags.in.required).toBe(true);
  });

  it('should have mode options', () => {
    expect(BackupImport.flags.mode.options).toEqual(['merge', 'overwrite', 'skip']);
    expect(BackupImport.flags.mode.default).toBe('merge');
  });

  it('should inherit BratCommand baseFlags', () => {
    expect(BackupImport.flags).toHaveProperty('verbose');
    expect(BackupImport.flags).toHaveProperty('context');
  });

  it('should be instantiable by oclif', () => {
    expect(() => {
      // @ts-ignore - oclif will handle instantiation
      new BackupImport([], {} as any);
    }).not.toThrow();
  });
});

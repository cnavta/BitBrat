/**
 * Smoke tests for brat backup export command
 * Sprint 361
 */

import BackupExport from './export';
import { BratCommand } from '../base';

describe('backup export command', () => {
  it('should extend BratCommand', () => {
    expect(Object.getPrototypeOf(BackupExport)).toBe(BratCommand);
  });

  it('should have description', () => {
    expect(BackupExport.description).toBeTruthy();
    expect(typeof BackupExport.description).toBe('string');
  });

  it('should have examples', () => {
    expect(BackupExport.examples).toBeDefined();
    expect(Array.isArray(BackupExport.examples)).toBe(true);
    expect(BackupExport.examples.length).toBeGreaterThan(0);
  });

  it('should have all required flags', () => {
    expect(BackupExport.flags).toHaveProperty('project-id');
    expect(BackupExport.flags).toHaveProperty('env');
    expect(BackupExport.flags).toHaveProperty('out');
    expect(BackupExport.flags).toHaveProperty('collections');
    expect(BackupExport.flags).toHaveProperty('include-secrets');
    expect(BackupExport.flags).toHaveProperty('pretty');
    expect(BackupExport.flags).toHaveProperty('json');
  });

  it('should inherit BratCommand baseFlags', () => {
    expect(BackupExport.flags).toHaveProperty('verbose');
    expect(BackupExport.flags).toHaveProperty('context');
  });

  it('should be instantiable by oclif', () => {
    expect(() => {
      // @ts-ignore - oclif will handle instantiation
      new BackupExport([], {} as any);
    }).not.toThrow();
  });
});

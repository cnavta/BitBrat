/**
 * Smoke tests for brat backup list command
 * Sprint 361
 */

import BackupList from './list';
import { BratCommand } from '../base';

describe('backup list command', () => {
  it('should extend BratCommand', () => {
    expect(Object.getPrototypeOf(BackupList)).toBe(BratCommand);
  });

  it('should have description', () => {
    expect(BackupList.description).toBeTruthy();
    expect(typeof BackupList.description).toBe('string');
  });

  it('should have examples', () => {
    expect(BackupList.examples).toBeDefined();
    expect(Array.isArray(BackupList.examples)).toBe(true);
    expect(BackupList.examples.length).toBeGreaterThan(0);
  });

  it('should have json flag', () => {
    expect(BackupList.flags).toHaveProperty('json');
    expect(BackupList.flags.json).toBeDefined();
  });

  it('should inherit BratCommand baseFlags', () => {
    expect(BackupList.flags).toHaveProperty('verbose');
    expect(BackupList.flags).toHaveProperty('context');
  });

  it('should be instantiable by oclif', () => {
    expect(() => {
      // @ts-ignore - oclif will handle instantiation
      new BackupList([], {} as any);
    }).not.toThrow();
  });
});

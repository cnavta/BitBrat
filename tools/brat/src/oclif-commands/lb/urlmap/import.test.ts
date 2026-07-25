/**
 * Smoke tests for brat lb urlmap import command
 * Sprint 362
 */

import LbUrlmapImport from './import';
import { BratCommand } from '../../base';

describe('lb urlmap import command', () => {
  it('should extend BratCommand', () => {
    expect(Object.getPrototypeOf(LbUrlmapImport)).toBe(BratCommand);
  });

  it('should have description', () => {
    expect(LbUrlmapImport.description).toBeTruthy();
    expect(typeof LbUrlmapImport.description).toBe('string');
  });

  it('should have examples', () => {
    expect(LbUrlmapImport.examples).toBeDefined();
    expect(Array.isArray(LbUrlmapImport.examples)).toBe(true);
    expect(LbUrlmapImport.examples.length).toBeGreaterThan(0);
  });

  it('should have all required flags', () => {
    expect(LbUrlmapImport.flags).toHaveProperty('project-id');
    expect(LbUrlmapImport.flags).toHaveProperty('dry-run');
  });

  it('should inherit BratCommand baseFlags', () => {
    expect(LbUrlmapImport.flags).toHaveProperty('verbose');
    expect(LbUrlmapImport.flags).toHaveProperty('context');
  });

  it('should be instantiable by oclif', () => {
    expect(() => {
      // @ts-ignore - oclif will handle instantiation
      new LbUrlmapImport([], {} as any);
    }).not.toThrow();
  });
});

/**
 * Smoke tests for brat lb urlmap render command
 * Sprint 362
 */

import LbUrlmapRender from './render';
import { BratCommand } from '../../base';

describe('lb urlmap render command', () => {
  it('should extend BratCommand', () => {
    expect(Object.getPrototypeOf(LbUrlmapRender)).toBe(BratCommand);
  });

  it('should have description', () => {
    expect(LbUrlmapRender.description).toBeTruthy();
    expect(typeof LbUrlmapRender.description).toBe('string');
  });

  it('should have examples', () => {
    expect(LbUrlmapRender.examples).toBeDefined();
    expect(Array.isArray(LbUrlmapRender.examples)).toBe(true);
    expect(LbUrlmapRender.examples.length).toBeGreaterThan(0);
  });

  it('should have all required flags', () => {
    expect(LbUrlmapRender.flags).toHaveProperty('project-id');
    expect(LbUrlmapRender.flags).toHaveProperty('out');
    expect(LbUrlmapRender.flags).toHaveProperty('json');
  });

  it('should inherit BratCommand baseFlags', () => {
    expect(LbUrlmapRender.flags).toHaveProperty('verbose');
    expect(LbUrlmapRender.flags).toHaveProperty('context');
  });

  it('should be instantiable by oclif', () => {
    expect(() => {
      // @ts-ignore - oclif will handle instantiation
      new LbUrlmapRender([], {} as any);
    }).not.toThrow();
  });
});

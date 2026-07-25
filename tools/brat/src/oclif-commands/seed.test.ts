/**
 * Smoke tests for brat seed command
 * Sprint 361
 */

import Seed from './seed';
import { BratCommand } from './base';

describe('seed command', () => {
  it('should extend BratCommand', () => {
    expect(Object.getPrototypeOf(Seed)).toBe(BratCommand);
  });

  it('should have description', () => {
    expect(Seed.description).toBeTruthy();
    expect(typeof Seed.description).toBe('string');
  });

  it('should have examples', () => {
    expect(Seed.examples).toBeDefined();
    expect(Array.isArray(Seed.examples)).toBe(true);
    expect(Seed.examples.length).toBeGreaterThan(0);
  });

  it('should have all flags', () => {
    expect(Seed.flags).toHaveProperty('bot-name');
    expect(Seed.flags).toHaveProperty('api-token');
    expect(Seed.flags).toHaveProperty('wipe');
    expect(Seed.flags).toHaveProperty('dry-run');
  });

  it('should default bot-name to BitBrat', () => {
    expect(Seed.flags['bot-name'].default).toBe('BitBrat');
  });

  it('should inherit BratCommand baseFlags', () => {
    expect(Seed.flags).toHaveProperty('verbose');
    expect(Seed.flags).toHaveProperty('context');
  });

  it('should be instantiable by oclif', () => {
    expect(() => {
      // @ts-ignore - oclif will handle instantiation
      new Seed([], {} as any);
    }).not.toThrow();
  });
});

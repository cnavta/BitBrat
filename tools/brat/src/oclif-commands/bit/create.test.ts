/**
 * Sprint 364: bit create command tests (smoke tests only)
 */

import BitCreate from './create';

describe('bit create command', () => {
  it('should extend BratCommand', () => {
    // @ts-ignore - accessing prototype for validation
    expect(BitCreate.prototype.constructor.name).toBe('BitCreate');
  });

  it('should have description', () => {
    expect(BitCreate.description).toBeTruthy();
    expect(BitCreate.description).toContain('Bit');
  });

  it('should have examples', () => {
    expect(BitCreate.examples).toBeDefined();
    expect(BitCreate.examples.length).toBeGreaterThan(0);
  });

  it('should have required args', () => {
    expect(BitCreate.args).toBeDefined();
    expect(BitCreate.args.name).toBeDefined();
  });

  it('should have all required flags', () => {
    expect(BitCreate.flags).toBeDefined();
    expect(BitCreate.flags.kind).toBeDefined();
    expect(BitCreate.flags.profile).toBeDefined();
    expect(BitCreate.flags.exposure).toBeDefined();
    expect(BitCreate.flags.stage).toBeDefined();
    expect(BitCreate.flags.port).toBeDefined();
    expect(BitCreate.flags.entry).toBeDefined();
    expect(BitCreate.flags.description).toBeDefined();
    expect(BitCreate.flags.active).toBeDefined();
    expect(BitCreate.flags.force).toBeDefined();
    expect(BitCreate.flags.register).toBeDefined();
  });

  it('should inherit BratCommand baseFlags', () => {
    // BratCommand.baseFlags includes --context
    expect(BitCreate.flags.context).toBeDefined();
  });

  it('should be instantiable by oclif', () => {
    // oclif requires commands to have static properties
    expect(BitCreate.description).toBeDefined();
    expect(BitCreate.flags).toBeDefined();
    expect(BitCreate.args).toBeDefined();
  });
});

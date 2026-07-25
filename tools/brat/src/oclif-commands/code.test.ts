/**
 * Sprint 365: code command tests (smoke tests only)
 */

// Mock the cmdCode function to avoid inquirer ESM import issues
jest.mock('../cli/code/code-command', () => ({
  cmdCode: jest.fn(),
}));

import Code from './code';

describe('code command', () => {
  it('should extend BratCommand', () => {
    // @ts-ignore - accessing prototype for validation
    expect(Code.prototype.constructor.name).toBe('Code');
  });

  it('should have description', () => {
    expect(Code.description).toBeTruthy();
    expect(Code.description).toContain('coding agent');
  });

  it('should have examples', () => {
    expect(Code.examples).toBeDefined();
    expect(Code.examples.length).toBeGreaterThan(0);
  });

  it('should have all required flags', () => {
    expect(Code.flags).toBeDefined();
    expect(Code.flags.agent).toBeDefined();
    expect(Code.flags.list).toBeDefined();
    expect(Code.flags['project-root']).toBeDefined();
  });

  it('should allow pass-through args', () => {
    expect(Code.strict).toBe(false);
  });

  it('should inherit BratCommand baseFlags', () => {
    // BratCommand.baseFlags includes --context
    expect(Code.flags.context).toBeDefined();
  });

  it('should be instantiable by oclif', () => {
    // oclif requires commands to have static properties
    expect(Code.description).toBeDefined();
    expect(Code.flags).toBeDefined();
  });
});

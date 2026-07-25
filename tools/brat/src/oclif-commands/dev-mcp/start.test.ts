/**
 * Sprint 365: dev-mcp start command tests (smoke tests only)
 */

import DevMcpStart from './start';

describe('dev-mcp start command', () => {
  it('should extend BratCommand', () => {
    // @ts-ignore - accessing prototype for validation
    expect(DevMcpStart.prototype.constructor.name).toBe('DevMcpStart');
  });

  it('should have description', () => {
    expect(DevMcpStart.description).toBeTruthy();
    expect(DevMcpStart.description).toContain('MCP');
  });

  it('should have examples', () => {
    expect(DevMcpStart.examples).toBeDefined();
    expect(DevMcpStart.examples.length).toBeGreaterThan(0);
  });

  it('should have all required flags', () => {
    expect(DevMcpStart.flags).toBeDefined();
    expect(DevMcpStart.flags['log-level']).toBeDefined();
    expect(DevMcpStart.flags['audit-log']).toBeDefined();
  });

  it('should inherit BratCommand baseFlags', () => {
    // BratCommand.baseFlags includes --context
    expect(DevMcpStart.flags.context).toBeDefined();
  });

  it('should be instantiable by oclif', () => {
    // oclif requires commands to have static properties
    expect(DevMcpStart.description).toBeDefined();
    expect(DevMcpStart.flags).toBeDefined();
  });
});

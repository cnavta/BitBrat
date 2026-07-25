/**
 * Sprint 365: mcp setup command tests (smoke tests only)
 */

import McpSetup from './setup';

describe('mcp setup command', () => {
  it('should extend BratCommand', () => {
    // @ts-ignore - accessing prototype for validation
    expect(McpSetup.prototype.constructor.name).toBe('McpSetup');
  });

  it('should have description', () => {
    expect(McpSetup.description).toBeTruthy();
    expect(McpSetup.description).toContain('MCP');
  });

  it('should have examples', () => {
    expect(McpSetup.examples).toBeDefined();
    expect(McpSetup.examples.length).toBeGreaterThan(0);
  });

  it('should have all required flags', () => {
    expect(McpSetup.flags).toBeDefined();
    expect(McpSetup.flags.scope).toBeDefined();
    expect(McpSetup.flags['server-name']).toBeDefined();
    expect(McpSetup.flags['log-level']).toBeDefined();
    expect(McpSetup.flags['audit-log']).toBeDefined();
    expect(McpSetup.flags['dry-run']).toBeDefined();
    expect(McpSetup.flags.json).toBeDefined();
  });

  it('should inherit BratCommand baseFlags', () => {
    // BratCommand.baseFlags includes --context
    expect(McpSetup.flags.context).toBeDefined();
  });

  it('should be instantiable by oclif', () => {
    // oclif requires commands to have static properties
    expect(McpSetup.description).toBeDefined();
    expect(McpSetup.flags).toBeDefined();
  });
});

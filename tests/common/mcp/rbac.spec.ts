import { RbacEvaluator } from '../../../src/common/mcp/rbac';
import { BitBratTool } from '../../../src/types/tools';
import { McpServerConfig, SessionContext } from '../../../src/common/mcp/types';

describe('RbacEvaluator', () => {
  const rbac = new RbacEvaluator();

  const mkTool = (overrides: Partial<BitBratTool> = {}): BitBratTool => ({
    id: 'mcp:demo',
    source: 'mcp',
    inputSchema: {} as any,
    ...overrides,
  });

  const mkServer = (overrides: Partial<McpServerConfig> = {}): McpServerConfig => ({
    name: 'demo',
    ...overrides,
  });

  const mkCtx = (overrides: Partial<SessionContext> = {}): SessionContext => ({
    roles: [],
    ...overrides,
  });

  it('denies when server requiredRoles not satisfied', () => {
    const server = mkServer({ requiredRoles: ['admin'] });
    const tool = mkTool();
    const ctx = mkCtx({ roles: [] });
    expect(rbac.isAllowedTool(tool, server, ctx)).toBe(false);
  });

  it('allows when server roles satisfied', () => {
    const server = mkServer({ requiredRoles: ['admin'] });
    const tool = mkTool();
    const ctx = mkCtx({ roles: ['reader', 'admin'] });
    expect(rbac.isAllowedTool(tool, server, ctx)).toBe(true);
  });

  it('denies when agent not in server allowlist', () => {
    const server = mkServer({ agentAllowlist: ['llm-bot'] });
    const tool = mkTool();
    const ctx = mkCtx({ agentName: 'ops-bot' });
    expect(rbac.isAllowedTool(tool, server, ctx)).toBe(false);
  });

  it('allows when agent is in server allowlist', () => {
    const server = mkServer({ agentAllowlist: ['llm-bot'] });
    const tool = mkTool();
    const ctx = mkCtx({ agentName: 'llm-bot' });
    expect(rbac.isAllowedTool(tool, server, ctx)).toBe(true);
  });

  it('applies tool-level requiredRoles', () => {
    const server = mkServer();
    const tool = mkTool({ requiredRoles: ['moderator'] });
    const ctx = mkCtx({ roles: ['user'] });
    expect(rbac.isAllowedTool(tool, server, ctx)).toBe(false);
  });

  it('applies tool-level agentAllowlist', () => {
    const server = mkServer();
    const tool = mkTool({ agentAllowlist: ['ops-bot'] });
    const ctx = mkCtx({ agentName: 'llm-bot' });
    expect(rbac.isAllowedTool(tool, server, ctx)).toBe(false);
  });
});

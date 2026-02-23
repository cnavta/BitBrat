import { BitBratTool } from '../../types/tools';
import { McpServerConfig, SessionContext } from './types';

export class RbacEvaluator {
  isAllowedServer(config: McpServerConfig, context: SessionContext): boolean {
    // Roles check (any-match)
    if (config.requiredRoles && config.requiredRoles.length > 0) {
      const hasAny = config.requiredRoles.some((r) => context.roles.includes(r));
      if (!hasAny) return false;
    }
    // Agent allowlist
    if (config.agentAllowlist && config.agentAllowlist.length > 0) {
      const agent = (context.agentName || '').trim();
      if (!agent || !config.agentAllowlist.includes(agent)) return false;
    }
    return true;
  }

  isAllowedTool(tool: BitBratTool, serverConfig: McpServerConfig | undefined, context: SessionContext): boolean {
    // If server-level policy blocks, deny
    if (serverConfig && !this.isAllowedServer(serverConfig, context)) return false;

    // Tool-level roles (any-match). If no roles specified, allow.
    if (tool.requiredRoles && tool.requiredRoles.length > 0) {
      const hasAny = tool.requiredRoles.some((r) => context.roles.includes(r));
      if (!hasAny) return false;
    }

    // Tool-level agent allowlist (if provided on tool metadata)
    if (tool.agentAllowlist && tool.agentAllowlist.length > 0) {
      const agent = (context.agentName || '').trim();
      if (!agent || !tool.agentAllowlist.includes(agent)) return false;
    }

    return true;
  }
}

import { BitBratTool, BitBratResource, BitBratPrompt } from '../../types/tools';
import { McpServerConfig, SessionContext } from './types';

export class RbacEvaluator {
  isAllowedServer(config: McpServerConfig, context: SessionContext): boolean {
    const agent = (context.agentName || '').trim();
    const isAgentAllowlisted = !!(config.agentAllowlist && config.agentAllowlist.length > 0 && config.agentAllowlist.includes(agent));

    // Trusted agent bypass
    if (isAgentAllowlisted) return true;

    // Roles check (any-match)
    if (config.requiredRoles && config.requiredRoles.length > 0) {
      const hasAny = config.requiredRoles.some((r) => context.roles.includes(r));
      if (!hasAny) return false;
    }

    // Agent allowlist (if not already bypassed)
    if (config.agentAllowlist && config.agentAllowlist.length > 0) {
      if (!isAgentAllowlisted) return false;
    }

    return true;
  }

  private isAllowedItem(
    item: { requiredRoles?: string[]; agentAllowlist?: string[] },
    serverConfig: McpServerConfig | undefined,
    context: SessionContext
  ): boolean {
    const agent = (context.agentName || '').trim();

    // If server-level policy allows via agent allowlist, bypass item checks
    if (serverConfig && serverConfig.agentAllowlist && serverConfig.agentAllowlist.length > 0) {
      if (serverConfig.agentAllowlist.includes(agent)) return true;
    }

    // If server-level policy blocks, deny
    if (serverConfig && !this.isAllowedServer(serverConfig, context)) return false;

    const isItemAgentAllowlisted = !!(item.agentAllowlist && item.agentAllowlist.length > 0 && item.agentAllowlist.includes(agent));

    // Trusted agent bypass at item level
    if (isItemAgentAllowlisted) return true;

    // Item-level roles (any-match). If no roles specified, allow.
    if (item.requiredRoles && item.requiredRoles.length > 0) {
      const hasAny = item.requiredRoles.some((r) => context.roles.includes(r));
      if (!hasAny) return false;
    }

    // Item-level agent allowlist
    if (item.agentAllowlist && item.agentAllowlist.length > 0) {
      if (!isItemAgentAllowlisted) return false;
    }

    return true;
  }

  isAllowedTool(tool: BitBratTool, serverConfig: McpServerConfig | undefined, context: SessionContext): boolean {
    const result = this.isAllowedItem(tool, serverConfig, context);

    // Sprint 27: CRITICAL - Debug RBAC filtering (log BOTH allow and deny)
    console.error(result ? '[RBAC ALLOW]' : '[RBAC DENY]', {
      toolId: tool.id,
      originServer: tool.originServer,
      serverConfigExists: !!serverConfig,
      serverHasRequiredRoles: !!(serverConfig?.requiredRoles && serverConfig.requiredRoles.length > 0),
      serverRequiredRoles: serverConfig?.requiredRoles,
      serverHasAgentAllowlist: !!(serverConfig?.agentAllowlist && serverConfig.agentAllowlist.length > 0),
      serverAgentAllowlist: serverConfig?.agentAllowlist,
      toolHasRequiredRoles: !!(tool.requiredRoles && tool.requiredRoles.length > 0),
      toolRequiredRoles: tool.requiredRoles,
      toolHasAgentAllowlist: !!(tool.agentAllowlist && tool.agentAllowlist.length > 0),
      toolAgentAllowlist: tool.agentAllowlist,
      contextRoles: context.roles,
      contextAgent: context.agentName,
      result
    });

    return result;
  }

  isAllowedResource(resource: BitBratResource, serverConfig: McpServerConfig | undefined, context: SessionContext): boolean {
    return this.isAllowedItem(resource, serverConfig, context);
  }

  isAllowedPrompt(prompt: BitBratPrompt, serverConfig: McpServerConfig | undefined, context: SessionContext): boolean {
    return this.isAllowedItem(prompt, serverConfig, context);
  }
}

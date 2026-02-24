import { BitBratTool, BitBratResource, BitBratPrompt } from '../../types/tools';
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

  private isAllowedItem(
    item: { requiredRoles?: string[]; agentAllowlist?: string[] },
    serverConfig: McpServerConfig | undefined,
    context: SessionContext
  ): boolean {
    // If server-level policy blocks, deny
    if (serverConfig && !this.isAllowedServer(serverConfig, context)) return false;

    // Item-level roles (any-match). If no roles specified, allow.
    if (item.requiredRoles && item.requiredRoles.length > 0) {
      const hasAny = item.requiredRoles.some((r) => context.roles.includes(r));
      if (!hasAny) return false;
    }

    // Item-level agent allowlist
    if (item.agentAllowlist && item.agentAllowlist.length > 0) {
      const agent = (context.agentName || '').trim();
      if (!agent || !item.agentAllowlist.includes(agent)) return false;
    }

    return true;
  }

  isAllowedTool(tool: BitBratTool, serverConfig: McpServerConfig | undefined, context: SessionContext): boolean {
    return this.isAllowedItem(tool, serverConfig, context);
  }

  isAllowedResource(resource: BitBratResource, serverConfig: McpServerConfig | undefined, context: SessionContext): boolean {
    return this.isAllowedItem(resource, serverConfig, context);
  }

  isAllowedPrompt(prompt: BitBratPrompt, serverConfig: McpServerConfig | undefined, context: SessionContext): boolean {
    return this.isAllowedItem(prompt, serverConfig, context);
  }
}

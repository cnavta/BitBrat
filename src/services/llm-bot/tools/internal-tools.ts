import { z } from 'zod';
import { BitBratTool, ToolExecutionContext, IToolRegistry } from '../../../types/tools';
import { McpClientManager } from '../../../common/mcp/client-manager';

/**
 * Tool: get_bot_status
 * Returns the current status of the bot, including connected MCP servers and usage stats.
 */
export function createGetBotStatusTool(mcpManager: McpClientManager): BitBratTool {
  return {
    id: 'internal:get_bot_status',
    source: 'internal',
    displayName: 'Get Bot Status',
    description: 'Returns the current status of the bot, including connected MCP servers and tool usage statistics.',
    inputSchema: z.object({}),
    execute: async (_args: any, _context: ToolExecutionContext) => {
      const stats = mcpManager.getStats();
      const allServerStats = stats.getAllServerStats();
      const allToolStats = stats.getAllToolStats();

      // Filter out some internals or format for better readability
      const servers = Object.entries(allServerStats).map(([name, s]) => ({
        name,
        status: s.status,
        transport: s.transport,
        uptime: s.uptime,
        invocations: s.totalInvocations,
        errors: s.totalErrors,
        avgLatencyMs: s.avgLatencyMs,
        tools: s.tools
      }));

      return {
        timestamp: new Date().toISOString(),
        servers,
        usageSummary: {
          totalServerInvocations: servers.reduce((acc, s) => acc + s.invocations, 0),
          totalServerErrors: servers.reduce((acc, s) => acc + s.errors, 0),
          totalRegisteredTools: Object.keys(allToolStats).length
        }
      };
    }
  };
}

/**
 * Tool: list_available_tools
 * Lists all tools available to the requester based on their roles.
 */
export function createListAvailableToolsTool(registry: IToolRegistry): BitBratTool {
  return {
    id: 'internal:list_available_tools',
    source: 'internal',
    displayName: 'List Available Tools',
    description: 'Lists all tools currently registered and available to you based on your permissions.',
    inputSchema: z.object({}),
    execute: async (_args: any, context: ToolExecutionContext) => {
      const allTools = registry.getTools();
      const userRoles = context.userRoles || [];

      const available = Object.values(allTools)
        .filter(tool => {
          if (!tool.requiredRoles || tool.requiredRoles.length === 0) return true;
          return tool.requiredRoles.some(role => userRoles.includes(role));
        })
        .map(tool => ({
          name: tool.id,
          displayName: tool.displayName,
          source: tool.source,
          description: tool.description,
          requiredRoles: tool.requiredRoles && tool.requiredRoles.length > 0 ? tool.requiredRoles : undefined
        }));

      return {
        requesterRoles: userRoles,
        availableTools: available,
        count: available.length
      };
    }
  };
}

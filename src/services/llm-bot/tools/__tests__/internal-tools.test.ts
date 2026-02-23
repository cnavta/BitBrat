import { createGetBotStatusTool, createListAvailableToolsTool } from '../internal-tools';
import { McpClientManager } from '../../../../common/mcp/client-manager';
import { IToolRegistry, BitBratTool } from '../../../../types/tools';
import { z } from 'zod';

describe('Internal Tools', () => {
  describe('get_bot_status', () => {
    it('should return bot status with server information', async () => {
      const mockStats = {
        getAllServerStats: jest.fn().mockReturnValue({
          'test-server': {
            status: 'connected',
            transport: 'stdio',
            uptime: '1h',
            totalInvocations: 10,
            totalErrors: 1,
            avgLatencyMs: 50,
            tools: ['tool1', 'tool2']
          }
        }),
        getAllToolStats: jest.fn().mockReturnValue({
          'mcp:tool1': {},
          'mcp:tool2': {}
        })
      };

      const mockMcpManager = {
        getStats: () => mockStats
      } as unknown as McpClientManager;

      const tool = createGetBotStatusTool(mockMcpManager);
      const result = await tool.execute!({}, { userRoles: ['admin'] });

      expect(result).toBeDefined();
      expect(result.servers).toHaveLength(1);
      expect(result.servers[0].name).toBe('test-server');
      expect(result.usageSummary.totalServerInvocations).toBe(10);
      expect(result.usageSummary.totalRegisteredTools).toBe(2);
    });
  });

  describe('list_available_tools', () => {
    const mockTools: Record<string, BitBratTool> = {
      'public-tool': {
        id: 'public-tool',
        source: 'internal',
        inputSchema: z.object({}),
        execute: async () => {}
      },
      'admin-tool': {
        id: 'admin-tool',
        source: 'internal',
        inputSchema: z.object({}),
        requiredRoles: ['admin'],
        execute: async () => {}
      },
      'mod-tool': {
        id: 'mod-tool',
        source: 'internal',
        inputSchema: z.object({}),
        requiredRoles: ['moderator'],
        execute: async () => {}
      }
    };

    const mockRegistry: IToolRegistry = {
      getTools: () => mockTools,
      registerTool: jest.fn(),
      unregisterTool: jest.fn(),
      getTool: jest.fn()
    };

    it('should list all tools for an admin', async () => {
      const tool = createListAvailableToolsTool(mockRegistry);
      const result = await tool.execute!({}, { userRoles: ['admin'] });

      expect(result.availableTools).toHaveLength(2); // public + admin
      expect(result.availableTools.find((t: any) => t.name === 'admin-tool')).toBeDefined();
      expect(result.availableTools.find((t: any) => t.name === 'mod-tool')).toBeUndefined();
    });

    it('should only list public tools for a user with no roles', async () => {
      const tool = createListAvailableToolsTool(mockRegistry);
      const result = await tool.execute!({}, { userRoles: [] });

      expect(result.availableTools).toHaveLength(1);
      expect(result.availableTools[0].name).toBe('public-tool');
    });

    it('should list moderator tools for a moderator', async () => {
      const tool = createListAvailableToolsTool(mockRegistry);
      const result = await tool.execute!({}, { userRoles: ['moderator'] });

      expect(result.availableTools).toHaveLength(2); // public + mod
      expect(result.availableTools.find((t: any) => t.name === 'mod-tool')).toBeDefined();
    });
  });
});

import { McpBridge } from '../../../../src/services/llm-bot/mcp/bridge';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpStatsCollector } from '../../../../src/services/llm-bot/mcp/stats-collector';

describe('McpBridge', () => {
  let mockClient: jest.Mocked<Client>;
  let bridge: McpBridge;
  let stats: McpStatsCollector;

  beforeEach(() => {
    mockClient = {
      callTool: jest.fn(),
    } as any;
    stats = new McpStatsCollector();
    bridge = new McpBridge(mockClient, 'test-server', stats);
  });

  it('should translate an MCP tool', () => {
    const mcpTool = {
      name: 'echo',
      description: 'Echos the input',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
        },
      },
    };

    const tool = bridge.translateTool(mcpTool);

    expect(tool.id).toBe('mcp:echo');
    expect(tool.displayName).toBe('echo');
    expect(tool.description).toBe('Echos the input');
    expect(tool.source).toBe('mcp');
    expect(tool.inputSchema).toBeDefined();
  });

  it('should forward execution to the MCP client and record stats', async () => {
    const mcpTool = {
      name: 'echo',
      inputSchema: { type: 'object' },
    };
    const tool = bridge.translateTool(mcpTool);

    mockClient.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'hello' }],
    });

    const result = await tool.execute!({ message: 'hello' }, { userRoles: [] });

    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: 'echo',
      arguments: { message: 'hello' },
    }, expect.anything());
    expect(result).toBe('hello');

    const sStats = stats.getServerStats('test-server');
    expect(sStats?.totalInvocations).toBe(1);
    expect(sStats?.totalErrors).toBe(0);
    
    const tStats = stats.getToolStats('mcp:echo');
    expect(tStats?.invocations).toBe(1);
    expect(tStats?.errors).toBe(0);
    expect(tStats?.lastResponseSize).toBeGreaterThan(0);
  });

  it('should handle tool execution errors and record error stats', async () => {
    const mcpTool = { name: 'fail', inputSchema: {} };
    const tool = bridge.translateTool(mcpTool);

    mockClient.callTool.mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'error message' }],
    });

    await expect(tool.execute!({}, { userRoles: [] })).rejects.toThrow('MCP Tool Error');

    const sStats = stats.getServerStats('test-server');
    expect(sStats?.totalErrors).toBe(1);
    
    const tStats = stats.getToolStats('mcp:fail');
    expect(tStats?.errors).toBe(1);
  });

  it('should sanitize "None" type in inputSchema', () => {
    const mcpTool = {
      name: 'python-tool',
      inputSchema: { type: 'None' },
    };

    const tool = bridge.translateTool(mcpTool);

    expect(tool.inputSchema).toBeDefined();
    // jsonSchema(schema) returns { jsonSchema: schema }
    expect((tool.inputSchema as any).jsonSchema.type).toBe('object');
  });
});

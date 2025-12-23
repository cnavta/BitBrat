import { McpBridge } from '../../../../src/services/llm-bot/mcp/bridge';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

describe('McpBridge', () => {
  let mockClient: jest.Mocked<Client>;
  let bridge: McpBridge;

  beforeEach(() => {
    mockClient = {
      callTool: jest.fn(),
    } as any;
    bridge = new McpBridge(mockClient);
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

  it('should forward execution to the MCP client', async () => {
    const mcpTool = {
      name: 'echo',
      inputSchema: { type: 'object' },
    };
    const tool = bridge.translateTool(mcpTool);

    mockClient.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'hello' }],
    });

    const result = await tool.execute!({ message: 'hello' });

    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: 'echo',
      arguments: { message: 'hello' },
    }, expect.anything());
    expect(result).toBe('hello');
  });

  it('should handle tool execution errors', async () => {
    const mcpTool = { name: 'fail', inputSchema: {} };
    const tool = bridge.translateTool(mcpTool);

    mockClient.callTool.mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'error message' }],
    });

    await expect(tool.execute!({})).rejects.toThrow('MCP Tool Error');
  });
});

import { McpClientManager } from '../../../../src/services/llm-bot/mcp/client-manager';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

jest.mock('@modelcontextprotocol/sdk/client/index.js');
jest.mock('@modelcontextprotocol/sdk/client/stdio.js');

describe('McpClientManager', () => {
  let mockServer: any;
  let mockRegistry: any;
  let manager: McpClientManager;
  let mockClientInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockServer = {
      getConfig: jest.fn(),
      getLogger: jest.fn().mockReturnValue({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
    };

    mockRegistry = {
      registerTool: jest.fn(),
    };

    mockClientInstance = {
      connect: jest.fn().mockResolvedValue(undefined),
      listTools: jest.fn().mockResolvedValue({ tools: [] }),
      close: jest.fn().mockResolvedValue(undefined),
    };

    (Client as unknown as jest.Mock).mockReturnValue(mockClientInstance);

    manager = new McpClientManager(mockServer, mockRegistry);
  });

  it('should initialize from config and connect to servers', async () => {
    mockServer.getConfig.mockReturnValue(JSON.stringify([
      { name: 'test-server', command: 'echo', args: ['hello'] }
    ]));

    await manager.initFromConfig();

    expect(Client).toHaveBeenCalled();
    expect(StdioClientTransport).toHaveBeenCalledWith(expect.objectContaining({
      command: 'echo',
      args: ['hello'],
    }));
    expect(mockClientInstance.connect).toHaveBeenCalled();
    expect(mockClientInstance.listTools).toHaveBeenCalled();
  });

  it('should register discovered tools', async () => {
    mockClientInstance.listTools.mockResolvedValue({
      tools: [
        { name: 'my-tool', description: 'desc', inputSchema: { type: 'object' } }
      ]
    });

    await manager.connectServer({ name: 'srv', command: 'cmd' });

    expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({
      id: 'mcp:my-tool',
    }));
  });

  it('should shutdown all clients', async () => {
    mockServer.getConfig.mockReturnValue(JSON.stringify([{ name: 's1', command: 'c1' }]));
    await manager.initFromConfig();

    await manager.shutdown();

    expect(mockClientInstance.close).toHaveBeenCalled();
  });
});

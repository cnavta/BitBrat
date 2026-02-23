import { McpClientManager } from '../../../../src/common/mcp/client-manager';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { getFirestore } from '../../../../src/common/firebase';

jest.mock('@modelcontextprotocol/sdk/client/index.js');
jest.mock('@modelcontextprotocol/sdk/client/stdio.js');
jest.mock('@modelcontextprotocol/sdk/client/sse.js');
jest.mock('../../../../src/common/firebase');

describe('McpClientManager', () => {
  let mockServer: any;
  let mockRegistry: any;
  let manager: McpClientManager;
  let mockClientInstance: any;
  let mockFirestore: any;
  let snapshotCallback: any;

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
      unregisterTool: jest.fn(),
    };

    mockClientInstance = {
      connect: jest.fn().mockResolvedValue(undefined),
      listTools: jest.fn().mockResolvedValue({ tools: [] }),
      close: jest.fn().mockResolvedValue(undefined),
    };

    (Client as unknown as jest.Mock).mockReturnValue(mockClientInstance);

    mockFirestore = {
      collection: jest.fn().mockReturnThis(),
      onSnapshot: jest.fn().mockImplementation((cb) => {
        snapshotCallback = cb;
        return jest.fn(); // unsubscribe
      }),
    };

    (getFirestore as jest.Mock).mockReturnValue(mockFirestore);

    manager = new McpClientManager(mockServer, mockRegistry);
  });

  it('should initialize and watch registry', async () => {
    await manager.initFromConfig();
    expect(mockFirestore.collection).toHaveBeenCalledWith('mcp_servers');
    expect(mockFirestore.onSnapshot).toHaveBeenCalled();
  });

  it('should connect to servers when snapshot updates and record status', async () => {
    await manager.initFromConfig();
    
    // Simulate added server
    await snapshotCallback({
      docChanges: () => [
        {
          type: 'added',
          doc: {
            id: 'id1',
            data: () => ({ name: 'test-server', command: 'echo', args: ['hello'], status: 'active' })
          }
        }
      ]
    });

    expect(Client).toHaveBeenCalled();
    expect(StdioClientTransport).toHaveBeenCalledWith(expect.objectContaining({
      command: 'echo',
      args: ['hello'],
    }));
    expect(mockClientInstance.connect).toHaveBeenCalled();
    expect(mockClientInstance.listTools).toHaveBeenCalled();

    const stats = manager.getStats().getServerStats('test-server');
    expect(stats?.status).toBe('connected');
    expect(stats?.transport).toBe('stdio');
  });

  it('should connect to SSE servers', async () => {
    await manager.connectServer({
      name: 'sse-server',
      transport: 'sse',
      url: 'https://mcp.example.com/sse'
    });

    expect(SSEClientTransport).toHaveBeenCalledWith(
      new URL('https://mcp.example.com/sse'),
      expect.objectContaining({
        requestInit: { headers: undefined }
      })
    );
    expect(mockClientInstance.connect).toHaveBeenCalled();
  });

  it('should throw error if SSE url is missing', async () => {
    const logger = mockServer.getLogger();
    await manager.connectServer({
      name: 'bad-sse',
      transport: 'sse'
    });

    expect(logger.error).toHaveBeenCalledWith(
      'mcp.client_manager.connect_error',
      expect.objectContaining({ error: new Error('SSE transport requires a URL for server bad-sse') })
    );
  });

  it('should register discovered tools and record discovery stats', async () => {
    mockClientInstance.listTools.mockResolvedValue({
      tools: [
        { name: 'my-tool', description: 'desc', inputSchema: { type: 'object' } }
      ]
    });

    await manager.connectServer({ name: 'srv', command: 'cmd' });

    expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({
      id: 'mcp:my-tool',
    }));

    const stats = manager.getStats().getServerStats('srv');
    expect(stats?.discoveryCount).toBe(1);
    expect(stats?.tools).toContain('mcp:my-tool');
  });

  it('should unregister tools when server is disconnected', async () => {
    mockClientInstance.listTools.mockResolvedValue({
      tools: [
        { name: 'tool1', description: 'desc', inputSchema: { type: 'object' } }
      ]
    });

    await manager.connectServer({ name: 'srv', command: 'cmd' });
    expect(mockRegistry.registerTool).toHaveBeenCalled();

    await manager.disconnectServer('srv');
    expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('mcp:tool1');
  });

  it('should shutdown all clients and unsubscribe', async () => {
    const unsubscribe = jest.fn();
    mockFirestore.onSnapshot.mockReturnValue(unsubscribe);
    
    await manager.initFromConfig();
    await manager.connectServer({ name: 's1', command: 'c1' });

    await manager.shutdown();

    expect(mockClientInstance.close).toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalled();
  });
});

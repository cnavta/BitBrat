import { McpClientManager, McpServerConfig } from './client-manager';
import { BaseServer } from '../../../common/base-server';
import { IToolRegistry } from '../../../types/tools';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

jest.mock('@modelcontextprotocol/sdk/client/stdio.js');
jest.mock('@modelcontextprotocol/sdk/client/sse.js');
jest.mock('@modelcontextprotocol/sdk/client/index.js');

describe('McpClientManager', () => {
  let mockServer: jest.Mocked<BaseServer>;
  let mockRegistry: jest.Mocked<IToolRegistry>;
  let manager: McpClientManager;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    mockServer = {
      getConfig: jest.fn(),
      getLogger: jest.fn().mockReturnValue(mockLogger),
    } as any;
    mockRegistry = {
      registerTool: jest.fn(),
    } as any;
    manager = new McpClientManager(mockServer, mockRegistry);

    (Client as jest.Mock).mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      listTools: jest.fn().mockResolvedValue({ tools: [] }),
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initFromConfig', () => {
    it('should parse array format', async () => {
      const config = [
        { name: 'test-stdio', command: 'node', args: ['script.js'] }
      ];
      mockServer.getConfig.mockReturnValue(JSON.stringify(config));
      
      const connectSpy = jest.spyOn(manager, 'connectServer').mockResolvedValue(undefined);
      
      await manager.initFromConfig();
      
      expect(connectSpy).toHaveBeenCalledWith(config[0]);
    });

    it('should parse mcpServers object format', async () => {
      const config = {
        mcpServers: {
          'test-sse': { url: 'http://localhost/sse' }
        }
      };
      mockServer.getConfig.mockReturnValue(JSON.stringify(config));
      
      const connectSpy = jest.spyOn(manager, 'connectServer').mockResolvedValue(undefined);
      
      await manager.initFromConfig();
      
      expect(connectSpy).toHaveBeenCalledWith({
        name: 'test-sse',
        url: 'http://localhost/sse'
      });
    });
  });

  describe('connectServer', () => {
    it('should use StdioClientTransport for stdio config', async () => {
      const config: McpServerConfig = {
        name: 'test-stdio',
        command: 'node',
        args: ['script.js'],
        env: { FOO: 'bar' }
      };

      await manager.connectServer(config);

      expect(StdioClientTransport).toHaveBeenCalledWith(expect.objectContaining({
        command: 'node',
        args: ['script.js']
      }));
    });

    it('should use SSEClientTransport for SSE config', async () => {
      const config: McpServerConfig = {
        name: 'test-sse',
        url: 'http://localhost/sse',
        headers: { Authorization: 'Bearer token' }
      };

      await manager.connectServer(config);

      expect(SSEClientTransport).toHaveBeenCalledWith(
        new URL('http://localhost/sse'),
        expect.objectContaining({
          eventSourceInit: {
            headers: config.headers
          },
          requestInit: {
            headers: config.headers
          }
        })
      );
    });

    it('should throw error for invalid config', async () => {
      const config: any = { name: 'invalid' };
      await manager.connectServer(config);
      expect(mockLogger.error).toHaveBeenCalledWith('mcp.client_manager.connect_error', expect.anything());
    });
  });
});

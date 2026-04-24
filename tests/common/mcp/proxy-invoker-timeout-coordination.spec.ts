import { ProxyInvoker } from '../../../src/common/mcp/proxy-invoker';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

describe('ProxyInvoker Timeout Coordination', () => {
  let mockClient: jest.Mocked<Client>;
  let invoker: ProxyInvoker;
  let mockLogger: any;

  beforeEach(() => {
    mockClient = {
      callTool: jest.fn(),
    } as any;
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    invoker = new ProxyInvoker({
      timeoutMs: 1000,
      logger: mockLogger,
    });
  });

  it('should distinguish Upstream Timeout', async () => {
    // Tool takes longer than 100ms
    mockClient.callTool.mockImplementation(() => new Promise((resolve) => 
      setTimeout(() => resolve({ content: [], isError: false } as any), 500)
    ));

    await expect(invoker.invoke('test-server', 'test-tool', {}, mockClient, undefined, { timeoutMs: 100 }))
      .rejects.toThrow(/Upstream Timeout/);
    
    expect(mockLogger.error).toHaveBeenCalledWith('mcp.proxy_invoker.upstream_timeout', expect.objectContaining({
      serverName: 'test-server',
      timeoutMs: 100
    }));
  });

  it('should distinguish Caller Abort', async () => {
    const controller = new AbortController();
    
    // Tool takes longer than we'll wait
    mockClient.callTool.mockImplementation(() => new Promise((resolve) => 
      setTimeout(() => resolve({ content: [], isError: false } as any), 1000)
    ));

    const invokePromise = invoker.invoke('test-server', 'test-tool', {}, mockClient, { 
      userRoles: [], 
      signal: controller.signal 
    });

    // Abort from caller side after 50ms
    setTimeout(() => controller.abort(), 50);

    await expect(invokePromise).rejects.toThrow(/Caller Abort/);
    
    expect(mockLogger.warn).toHaveBeenCalledWith('mcp.proxy_invoker.caller_abort', expect.objectContaining({
      serverName: 'test-server'
    }));
  });

  it('should handle already aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();

    // Tool would take time
    mockClient.callTool.mockImplementation(() => new Promise(() => {}));

    await expect(invoker.invoke('test-server', 'test-tool', {}, mockClient, { 
      userRoles: [], 
      signal: controller.signal 
    })).rejects.toThrow(/was already aborted/);
  });
});

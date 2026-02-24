import { McpClientManager } from '../../../src/common/mcp/client-manager';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

jest.mock('@modelcontextprotocol/sdk/client/index.js');
jest.mock('@modelcontextprotocol/sdk/client/sse.js');

describe('McpClientManager auto-reconnect', () => {
  let mockServer: any;
  let mockRegistry: any;
  let manager: McpClientManager;
  let mockClientInstance: any;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0.5); // neutralize jitter (0)
    process.env.MCP_RECONNECT_BASE_MS = '100';
    process.env.MCP_RECONNECT_MAX_MS = '100';
    process.env.MCP_RECONNECT_JITTER = '0';
    process.env.MCP_RECONNECT_MONITOR_MS = '0'; // disable background monitor for this test

    mockServer = {
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
      registerResource: jest.fn(),
      unregisterResource: jest.fn(),
      registerPrompt: jest.fn(),
      unregisterPrompt: jest.fn(),
      getTools: jest.fn().mockReturnValue({}),
      getResources: jest.fn().mockReturnValue({}),
      getPrompts: jest.fn().mockReturnValue({}),
    };

    mockClientInstance = {
      connect: jest.fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED')) // first attempt fails
        .mockResolvedValueOnce(undefined),              // second attempt succeeds
      close: jest.fn().mockResolvedValue(undefined),
      listTools: jest.fn().mockResolvedValue({ tools: [] }),
      listResources: jest.fn().mockResolvedValue({ resources: [] }),
      listPrompts: jest.fn().mockResolvedValue({ prompts: [] }),
    };

    (Client as unknown as jest.Mock).mockReturnValue(mockClientInstance);

    manager = new McpClientManager(mockServer, mockRegistry);
  });

  afterEach(async () => {
    jest.useRealTimers();
    jest.spyOn(Math, 'random').mockRestore();
    await manager.shutdown();
  });

  it('schedules a reconnect after initial connect failure and eventually connects', async () => {
    await manager.connectServer({
      name: 'tool-gateway',
      transport: 'sse',
      url: 'http://tool-gateway.bitbrat.local:3000/sse',
    });

    // Initial attempt failed
    expect(mockClientInstance.connect).toHaveBeenCalledTimes(1);

    // A reconnect should be scheduled (~100ms). Advance timers to trigger it.
    jest.advanceTimersByTime(120);

    // Allow the reconnect promise chain to resolve
    await Promise.resolve();

    // Second attempt should have been made and succeeded
    expect(mockClientInstance.connect).toHaveBeenCalledTimes(2);

    const status = manager.getStats().getServerStats('tool-gateway')?.status;
    expect(status).toBe('connected');
  });

  it('cancels pending reconnects on disconnect', async () => {
    await manager.connectServer({
      name: 'gw2',
      transport: 'sse',
      url: 'http://tool-gateway.bitbrat.local:3000/sse',
    });

    // One failed attempt
    expect(mockClientInstance.connect).toHaveBeenCalledTimes(1);

    // Immediately disconnect; further timer should not lead to another connect call
    await manager.disconnectServer('gw2');

    jest.advanceTimersByTime(200);
    await Promise.resolve();

    // Still only one connect call (no reconnect after disconnect)
    expect(mockClientInstance.connect).toHaveBeenCalledTimes(1);
  });
});

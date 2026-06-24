import { McpClientManager } from '../../../src/common/mcp/client-manager';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

jest.mock('@modelcontextprotocol/sdk/client/index.js');
jest.mock('@modelcontextprotocol/sdk/client/sse.js');
jest.mock('@modelcontextprotocol/sdk/client/stdio.js');

const SECRET = 'sk-super-secret-value-XYZ';

describe('McpClientManager env/args ${VAR} resolution', () => {
  let mockServer: any;
  let mockRegistry: any;
  let manager: McpClientManager;
  let mockClientInstance: any;
  let logger: any;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MCP_RECONNECT_MONITOR_MS = '0'; // disable background monitor

    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    mockServer = { getLogger: jest.fn().mockReturnValue(logger) };

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
      connect: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      listTools: jest.fn().mockResolvedValue({ tools: [] }),
      listResources: jest.fn().mockResolvedValue({ resources: [] }),
      listPrompts: jest.fn().mockResolvedValue({ prompts: [] }),
    };
    (Client as unknown as jest.Mock).mockReturnValue(mockClientInstance);

    manager = new McpClientManager(mockServer, mockRegistry);
  });

  afterEach(async () => {
    await manager.shutdown();
    process.env = { ...savedEnv };
  });

  function allLoggedText(): string {
    const calls = [
      ...logger.debug.mock.calls,
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ];
    return JSON.stringify(calls);
  }

  it('resolves stdio env and args references into the transport', async () => {
    process.env.MY_SECRET = SECRET;
    process.env.REGION = 'us-east1';

    await manager.connectServer({
      name: 'img-mcp',
      transport: 'stdio',
      command: 'node',
      args: ['server.js', '--region=${REGION}'],
      env: { API_KEY: '${MY_SECRET}', PLAIN: 'literal' },
    } as any);

    const opts = (StdioClientTransport as unknown as jest.Mock).mock.calls[0][0];
    expect(opts.args).toEqual(['server.js', '--region=us-east1']);
    expect(opts.env.API_KEY).toBe(SECRET);
    expect(opts.env.PLAIN).toBe('literal');
    // process.env is merged in
    expect(opts.env.REGION).toBe('us-east1');
  });

  it('resolves SSE header references into requestInit.headers', async () => {
    process.env.AUTH_TOKEN = SECRET;

    await manager.connectServer({
      name: 'sse-mcp',
      transport: 'sse',
      url: 'http://sse-mcp.local:3000/sse',
      env: { Authorization: 'Bearer ${AUTH_TOKEN}' },
    } as any);

    const headers = (SSEClientTransport as unknown as jest.Mock).mock.calls[0][1]
      .requestInit.headers;
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`);
  });

  it('leaves a literal-only config byte-for-byte unchanged', async () => {
    await manager.connectServer({
      name: 'lit-mcp',
      transport: 'stdio',
      command: 'node',
      args: ['server.js', '--flag'],
      env: { FOO: 'bar' },
    } as any);

    const opts = (StdioClientTransport as unknown as jest.Mock).mock.calls[0][0];
    expect(opts.args).toEqual(['server.js', '--flag']);
    expect(opts.env.FOO).toBe('bar');
    // No env_ref logs emitted for a literal config
    expect(logger.info).not.toHaveBeenCalledWith('mcp.config.env_ref.resolved', expect.anything());
    expect(logger.warn).not.toHaveBeenCalledWith('mcp.config.env_ref.unresolved', expect.anything());
  });

  it('substitutes empty string for an unresolved ref and warns with names only (no throw)', async () => {
    delete process.env.NOPE;

    await expect(
      manager.connectServer({
        name: 'unresolved-mcp',
        transport: 'stdio',
        command: 'node',
        args: ['s.js'],
        env: { TOKEN: '${NOPE}' },
      } as any)
    ).resolves.toBeUndefined();

    const opts = (StdioClientTransport as unknown as jest.Mock).mock.calls[0][0];
    expect(opts.env.TOKEN).toBe('');
    expect(logger.warn).toHaveBeenCalledWith(
      'mcp.config.env_ref.unresolved',
      expect.objectContaining({ name: 'unresolved-mcp', unresolved: ['NOPE'] })
    );
  });

  it('never logs resolved secret values (names only)', async () => {
    process.env.MY_SECRET = SECRET;

    await manager.connectServer({
      name: 'secret-mcp',
      transport: 'stdio',
      command: 'node',
      args: ['s.js'],
      env: { API_KEY: '${MY_SECRET}' },
    } as any);

    expect(allLoggedText()).not.toContain(SECRET);
    // The reference name IS logged.
    expect(logger.info).toHaveBeenCalledWith(
      'mcp.config.env_ref.resolved',
      expect.objectContaining({ name: 'secret-mcp', refsUsed: ['MY_SECRET'] })
    );
  });

  it('does not churn a healthy connection when env and config are unchanged', async () => {
    process.env.AUTH_TOKEN = SECRET;
    const cfg: any = {
      name: 'idem-mcp',
      transport: 'sse',
      url: 'http://idem-mcp.local:3000/sse',
      env: { Authorization: 'Bearer ${AUTH_TOKEN}' },
    };

    await manager.connectServer(cfg);
    expect(mockClientInstance.connect).toHaveBeenCalledTimes(1);

    // Benign metadata-only rewrite, same env -> no reconnect.
    await manager.connectServer({ ...cfg, updatedAt: 'now', correlationId: 'c-1' });
    expect(mockClientInstance.connect).toHaveBeenCalledTimes(1);
    expect(mockClientInstance.close).not.toHaveBeenCalled();
  });

  it('reconnects exactly once when the underlying referenced value rotates', async () => {
    process.env.AUTH_TOKEN = SECRET;
    const cfg: any = {
      name: 'rot-mcp',
      transport: 'sse',
      url: 'http://rot-mcp.local:3000/sse',
      env: { Authorization: 'Bearer ${AUTH_TOKEN}' },
    };

    await manager.connectServer(cfg);
    expect(mockClientInstance.connect).toHaveBeenCalledTimes(1);

    // Rotate the underlying secret; same Firestore doc.
    const ROTATED = 'sk-rotated-value-ABC';
    process.env.AUTH_TOKEN = ROTATED;
    await manager.connectServer(cfg);

    expect(mockClientInstance.close).toHaveBeenCalledTimes(1);
    expect(mockClientInstance.connect).toHaveBeenCalledTimes(2);
    const lastHeaders = (SSEClientTransport as unknown as jest.Mock).mock.calls.at(-1)![1]
      .requestInit.headers;
    expect(lastHeaders.Authorization).toBe(`Bearer ${ROTATED}`);
  });
});

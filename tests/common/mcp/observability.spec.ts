import { McpObservability, IToolUsageStore, ToolUsageRecord } from '../../../src/common/mcp/observability';

describe('McpObservability', () => {
  let mockStore: jest.Mocked<IToolUsageStore>;

  beforeEach(() => {
    // Create a mock IToolUsageStore
    mockStore = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    // Inject the mock store before each test
    McpObservability.setToolUsageStore(mockStore);
  });

  afterEach(() => {
    // Reset the store to null after each test
    McpObservability.setToolUsageStore(null as any);
  });

  it('should record a call to store and OTel', async () => {
    const context = {
      userRoles: ['admin'],
      userId: 'user-123',
      agentName: 'test-agent',
      correlationId: 'corr-456',
    };

    await McpObservability.recordCall(
      'test-server',
      'test-tool',
      150,
      false,
      context
    );

    // Give the async fire-and-forget operation time to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(mockStore.record).toHaveBeenCalledWith(expect.objectContaining({
      server: 'test-server',
      tool: 'test-tool',
      durationMs: 150,
      status: 'OK',
      userId: 'user-123',
      agent: 'test-agent',
      correlationId: 'corr-456',
      errorCode: null,
    } as Partial<ToolUsageRecord>));
  });

  it('should record an error to store', async () => {
    const error = new Error('Execution failed');
    (error as any).code = 'EXEC_ERR';

    await McpObservability.recordCall(
      'test-server',
      'test-tool',
      200,
      true,
      undefined,
      error
    );

    // Give the async fire-and-forget operation time to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(mockStore.record).toHaveBeenCalledWith(expect.objectContaining({
      status: 'ERROR',
      errorCode: 'EXEC_ERR',
    } as Partial<ToolUsageRecord>));
  });

  it('should not throw if store fails', async () => {
    mockStore.record.mockRejectedValue(new Error('Store down'));

    // Should not throw (fire-and-forget pattern)
    await expect(McpObservability.recordCall('s', 't', 1, false)).resolves.not.toThrow();
  });
});

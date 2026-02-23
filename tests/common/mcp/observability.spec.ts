import { McpObservability } from '../../../src/common/mcp/observability';
import { getFirestore } from '../../../src/common/firebase';

jest.mock('../../../src/common/firebase');

describe('McpObservability', () => {
  let mockFirestore: any;
  let mockAdd: jest.Mock;

  beforeEach(() => {
    mockAdd = jest.fn().mockResolvedValue({ id: 'doc-id' });
    mockFirestore = {
      collection: jest.fn().mockReturnThis(),
      add: mockAdd,
    };
    (getFirestore as jest.Mock).mockReturnValue(mockFirestore);
  });

  it('should record a call to Firestore and OTel', async () => {
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

    expect(mockFirestore.collection).toHaveBeenCalledWith('tool_usage');
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      server: 'test-server',
      tool: 'test-tool',
      durationMs: 150,
      status: 'OK',
      userId: 'user-123',
      agent: 'test-agent',
      correlationId: 'corr-456',
    }));
  });

  it('should record an error to Firestore', async () => {
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

    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      status: 'ERROR',
      errorCode: 'EXEC_ERR',
    }));
  });

  it('should not throw if Firestore fails', async () => {
    mockAdd.mockRejectedValue(new Error('Firestore down'));
    
    // Should not throw
    await expect(McpObservability.recordCall('s', 't', 1, false)).resolves.not.toThrow();
  });
});

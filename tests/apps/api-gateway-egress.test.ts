import { ApiGatewayServer } from '../../src/apps/api-gateway';
import { EgressResult } from '../../src/services/api-gateway/egress';
import { INTERNAL_EGRESS_V1, INTERNAL_DEADLETTER_V1 } from '../../src/types/events';

// Mock dependencies
jest.mock('../../src/services/api-gateway/auth');
jest.mock('../../src/services/api-gateway/ingress');
jest.mock('../../src/services/api-gateway/egress');
jest.mock('../../src/services/message-bus', () => ({
  createMessageSubscriber: jest.fn().mockReturnValue({
    subscribe: jest.fn().mockResolvedValue(jest.fn())
  }),
  createMessagePublisher: jest.fn().mockReturnValue({
    publishJson: jest.fn().mockResolvedValue({ messageId: '123' })
  })
}));

describe('ApiGatewayServer - Generic Egress', () => {
  let server: ApiGatewayServer;
  let mockEgressManager: any;

  beforeEach(() => {
    jest.clearAllMocks();
    server = new ApiGatewayServer();
    // Inject mocks into the server's private properties if needed, 
    // but they are initialized in start().
  });

  afterEach(async () => {
    await server.close('test');
  });

  it('should subscribe to internal.egress.v1 on start', async () => {
    const { createMessageSubscriber } = require('../../src/services/message-bus');
    const subscriber = createMessageSubscriber();
    
    // Mock resources needed for start
    (server as any).getResource = jest.fn().mockImplementation((name: string) => {
      if (name === 'firestore') return {};
      if (name === 'publisher') return { create: jest.fn().mockReturnValue({ publishJson: jest.fn() }) };
      return undefined;
    });

    await server.start(0);

    // Verify subscription
    expect(subscriber.subscribe).toHaveBeenCalledWith(
      expect.stringContaining(INTERNAL_EGRESS_V1),
      expect.any(Function),
      expect.anything()
    );
  });

  it('should publish to DLQ if egress delivery fails', async () => {
    const { createMessageSubscriber } = require('../../src/services/message-bus');
    let capturedHandler: any;
    createMessageSubscriber().subscribe.mockImplementation((subj: string, handler: any) => {
      if (subj.includes(INTERNAL_EGRESS_V1)) {
        capturedHandler = handler;
      }
      return jest.fn();
    });

    const mockDlqPublisher = { publishJson: jest.fn() };
    (server as any).getResource = jest.fn().mockImplementation((name: string) => {
      if (name === 'firestore') return {};
      if (name === 'publisher') return { create: jest.fn().mockReturnValue(mockDlqPublisher) };
      return undefined;
    });

    await server.start(0);

    // Mock handleEgressEvent to return FAILED
    const { EgressResult } = require('../../src/services/api-gateway/egress');
    const egressManager = (server as any).egressManager;
    egressManager.handleEgressEvent.mockResolvedValue(EgressResult.FAILED);

    // Simulate message
    const evt = { correlationId: 'c1', type: 'chat.message', userId: 'u1' };
    await capturedHandler(Buffer.from(JSON.stringify(evt)), {}, { ack: jest.fn(), nack: jest.fn() });

    // Verify DLQ
    expect(mockDlqPublisher.publishJson).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'router.deadletter.v1',
        payload: expect.objectContaining({
          reason: 'websocket_delivery_failed'
        })
      })
    );
  });
});

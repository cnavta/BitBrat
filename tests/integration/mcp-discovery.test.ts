import { ToolGatewayServer } from '../../src/apps/tool-gateway';
import { McpServer } from '../../src/common/mcp-server';
import { INTERNAL_MCP_REGISTRATION_V1 } from '../../src/types/events';
import { EventEmitter } from 'events';

const sharedBus = new EventEmitter();

// Mock message bus
jest.mock('../../src/services/message-bus', () => ({
  createMessagePublisher: (subject: string) => ({
    publishJson: async (data: any, attributes: any) => {
      setImmediate(() => {
        sharedBus.emit(subject, { 
          data: Buffer.from(JSON.stringify(data)), 
          attributes: attributes || {} 
        });
      });
      return 'msg-' + Math.random();
    },
    flush: async () => {}
  }),
  createMessageSubscriber: () => ({
    subscribe: async (subject: string, handler: any) => {
      const wrapper = ({ data, attributes }: any) => {
        // data coming in from emitter is Buffer, handler expects parsed JSON if using onMessage wrapper in BaseServer
        // but here onMessage in BaseServer handles the parsing.
        handler(data, attributes, { 
          ack: async () => {}, 
          nack: async () => {} 
        });
      };
      sharedBus.on(subject, wrapper);
      return async () => { sharedBus.off(subject, wrapper); };
    }
  }),
  normalizeAttributes: (a: any) => a
}));

// Mock Firestore
const mockDoc = {
  set: jest.fn().mockResolvedValue(undefined)
};
const mockCollection = {
  doc: jest.fn().mockReturnValue(mockDoc),
  onSnapshot: jest.fn().mockReturnValue(() => {})
};
const mockFirestore = {
  collection: jest.fn().mockReturnValue(mockCollection),
  settings: jest.fn()
};

jest.mock('../../src/common/firebase', () => ({
  getFirestore: () => mockFirestore,
  configureFirestore: () => {}
}));

describe('MCP Auto-Discovery Integration', () => {
  let toolGateway: ToolGatewayServer;

  beforeAll(async () => {
    // Force production mode to enable subscriptions
    process.env.NODE_ENV = 'production';
    delete process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE;
    
    // Config for tool-gateway
    process.env.SERVICE_NAME = 'tool-gateway';
    
    toolGateway = new ToolGatewayServer();
    await toolGateway.start(0);
  });

  afterAll(async () => {
    if (toolGateway) await toolGateway.close('test');
    sharedBus.removeAllListeners();
  });

  it('should auto-register an McpServer when it starts', async () => {
    // 1. Setup environment for the dummy server
    process.env.MCP_EXTERNAL_URL = 'http://dummy-server/sse';
    process.env.MCP_AUTH_TOKEN = 'dummy-token';

    // 2. Create a dummy McpServer
    const dummyServer = new McpServer({ serviceName: 'dummy-service' });
    
    // 3. Start the dummy server
    // It should publish the registration event
    await dummyServer.start(0);

    // 4. Wait for the event to be processed by tool-gateway
    await new Promise(resolve => setTimeout(resolve, 500));

    // 5. Verify Firestore was updated correctly
    expect(mockFirestore.collection).toHaveBeenCalledWith('mcp_servers');
    expect(mockCollection.doc).toHaveBeenCalledWith('dummy-service');
    expect(mockDoc.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'dummy-service',
        url: 'http://dummy-server/sse',
        transport: 'sse',
        env: {
          Authorization: 'Bearer dummy-token'
        }
      }),
      { merge: true }
    );

    await dummyServer.close('test');
  });
});

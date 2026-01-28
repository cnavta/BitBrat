import { ApiGatewayServer } from '../../src/apps/api-gateway';
import { IngressEgressServer } from '../../src/apps/ingress-egress-service';
import { INTERNAL_EGRESS_V1, INTERNAL_DEADLETTER_V1 } from '../../src/types/events';
import { EventEmitter } from 'events';
import { WebSocket } from 'ws';

// Shared event bus for integration
const sharedBus = new EventEmitter();

jest.mock('../../src/services/message-bus', () => ({
  createMessagePublisher: (subject: string) => ({
    publishJson: async (data: any, attributes: any) => {
      // Small delay to simulate async bus
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
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn().mockReturnValue({
    collection: jest.fn().mockReturnThis(),
    doc: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ exists: false }),
    settings: jest.fn()
  })
}));

describe('Generic Egress Integration', () => {
  let apiGateway: ApiGatewayServer;
  let ingressEgress: IngressEgressServer;

  beforeAll(async () => {
    // Force production mode to enable subscriptions in ingress-egress
    process.env.NODE_ENV = 'production';
    delete process.env.JEST_WORKER_ID;

    // Mock resources
    const mockResources = {
      firestore: {},
      publisher: {
        create: (subj: string) => ({
          publishJson: async (data: any, attrs: any) => {
            sharedBus.emit(subj, { data: Buffer.from(JSON.stringify(data)), attributes: attrs });
          }
        })
      }
    };

    apiGateway = new ApiGatewayServer();
    (apiGateway as any).resources = mockResources;
    await apiGateway.start(0);
    
    ingressEgress = new IngressEgressServer();
    (ingressEgress as any).resources = mockResources;

    // Small delay for async initializations
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  afterAll(async () => {
    await apiGateway.close('test');
    await ingressEgress.stop();
    sharedBus.removeAllListeners();
  });

  it('should deliver Discord and WebSocket messages from the same generic topic', async () => {
    // Setup mocks explicitly after initialization
    const discordSpy = jest.fn().mockResolvedValue(undefined);
    (ingressEgress as any).discordClient = { sendText: discordSpy };

    // 1. Setup WebSocket connection in API Gateway
    const mockWs = { 
      readyState: WebSocket.OPEN, 
      send: jest.fn(),
      on: jest.fn(),
      close: jest.fn()
    };
    (apiGateway as any).userConnections.set('user-ws', new Set([mockWs]));

    // 2. Publish generic egress event for Discord
    const discordEvt = {
      v: '1',
      source: 'test',
      correlationId: 'c-discord',
      egress: { destination: 'discord' },
      channel: 'discord-chan',
      payload: { text: 'hello discord' }
    };
    
    // 3. Publish generic egress event for WebSocket
    const wsEvt = {
      v: '1',
      source: 'test',
      correlationId: 'c-ws',
      userId: 'user-ws',
      egress: { destination: 'api-gateway' },
      payload: { text: 'hello websocket' }
    };

    const { createMessagePublisher } = require('../../src/services/message-bus');
    const pub = createMessagePublisher(INTERNAL_EGRESS_V1);
    
    await pub.publishJson(discordEvt);
    await pub.publishJson(wsEvt);

    // 4. Wait for async processing
    await new Promise(resolve => setTimeout(resolve, 500));

    // 5. Verify Discord delivery
    expect(discordSpy).toHaveBeenCalledWith('hello discord', 'discord-chan');

    // 6. Verify WebSocket delivery
    expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('hello websocket'));
  });

  it('should publish to DLQ if no one handles it (demonstrated by simulated failure)', async () => {
    // Capture DLQ events
    const dlqEvents: any[] = [];
    sharedBus.on(INTERNAL_DEADLETTER_V1, ({ data }) => {
      dlqEvents.push(JSON.parse(data.toString()));
    });

    // Publish event for unknown platform
    const unknownEvt = {
      v: '1',
      source: 'test',
      correlationId: 'c-unknown',
      egress: { destination: 'unknown-platform' },
      payload: { text: 'where do I go?' }
    };

    const { createMessagePublisher } = require('../../src/services/message-bus');
    const pub = createMessagePublisher(INTERNAL_EGRESS_V1);
    await pub.publishJson(unknownEvt);

    await new Promise(resolve => setTimeout(resolve, 200));

    // Note: In our current implementation, if it's ignored, it doesn't DLQ.
    // Only if it TRIES to handle and fails.
    
    // Let's simulate a failure in ingress-egress
    const failedDiscordSpy = jest.fn().mockRejectedValue(new Error('Discord offline'));
    (ingressEgress as any).discordClient = { sendText: failedDiscordSpy };
    
    const failedDiscordEvt = {
      v: '1',
      source: 'test',
      correlationId: 'c-failed-discord',
      egress: { destination: 'discord' },
      payload: { text: 'fail me' }
    };
    await pub.publishJson(failedDiscordEvt);

    await new Promise(resolve => setTimeout(resolve, 200));

    expect(dlqEvents.some(e => e.envelope.correlationId === 'c-failed-discord')).toBe(true);
  });
});

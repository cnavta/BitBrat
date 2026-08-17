import { IngressEgressServer } from '../../src/apps/ingress-egress-service';
import { INTERNAL_EGRESS_V1, INTERNAL_DEADLETTER_V1 } from '../../src/types/events';

// Mock dependencies
jest.mock('../../src/services/ingress/twitch');
jest.mock('../../src/services/ingress/discord');
jest.mock('../../src/services/ingress/twilio');
jest.mock('../../src/services/message-bus', () => ({
  createMessageSubscriber: jest.fn().mockReturnValue({
    subscribe: jest.fn().mockResolvedValue(jest.fn())
  }),
  createMessagePublisher: jest.fn().mockReturnValue({
    publishJson: jest.fn().mockResolvedValue({ messageId: '123' })
  })
}));

describe('IngressEgressServer - Generic Egress', () => {
  let server: IngressEgressServer | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    if (server) await server.stop();
    server = undefined;
  });

  it('should subscribe to internal.egress.v1 on start', async () => {
    const { createMessageSubscriber } = require('../../src/services/message-bus');
    const subscriber = createMessageSubscriber();
    
    // Force isTestEnv to false inside constructor check
    const oldWorkerId = process.env.JEST_WORKER_ID;
    delete process.env.JEST_WORKER_ID;
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      server = new IngressEgressServer();
      // Small delay to allow async setupApp to run
      await new Promise(resolve => setTimeout(resolve, 50));
    } finally {
      process.env.JEST_WORKER_ID = oldWorkerId;
      process.env.NODE_ENV = oldNodeEnv;
    }

    // Verify subscription
    expect(subscriber.subscribe).toHaveBeenCalledWith(
      expect.stringContaining(INTERNAL_EGRESS_V1),
      expect.any(Function),
      expect.objectContaining({ queue: expect.stringMatching(/^ingress-egress\..+$/) })
    );
  });

  it('should deliver Discord message from generic topic', async () => {
    const { createMessageSubscriber } = require('../../src/services/message-bus');
    let capturedHandler: any;
    createMessageSubscriber().subscribe.mockImplementation((subj: string, handler: any, opts: any) => {
      if (subj === INTERNAL_EGRESS_V1 && opts?.queue?.startsWith('ingress-egress.')) {
        capturedHandler = handler;
      }
      return jest.fn();
    });

    // Force isTestEnv to false inside constructor check
    const oldWorkerId = process.env.JEST_WORKER_ID;
    delete process.env.JEST_WORKER_ID;
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      server = new IngressEgressServer();
      await new Promise(resolve => setTimeout(resolve, 50));
    } finally {
      process.env.JEST_WORKER_ID = oldWorkerId;
      process.env.NODE_ENV = oldNodeEnv;
    }

    // Mock discordClient
    const mockDiscordClient = { 
      sendText: jest.fn().mockResolvedValue(undefined),
      getSnapshot: () => ({ state: 'CONNECTED' })
    };
    (server as any).discordClient = mockDiscordClient;

    // Simulate message
    const evt = { 
      v: '2',
      source: 'some-service',
      correlationId: 'c1',
      egress: { destination: 'discord' }, 
      channel: '12345',
      payload: { text: 'hello discord' }
    };
    
    await capturedHandler(Buffer.from(JSON.stringify(evt)), {}, { ack: jest.fn(), nack: jest.fn() });

    expect(mockDiscordClient.sendText).toHaveBeenCalledWith('hello discord', '12345');
  });

  it('should publish to DLQ if delivery fails', async () => {
    const { createMessageSubscriber } = require('../../src/services/message-bus');
    let capturedHandler: any;
    createMessageSubscriber().subscribe.mockImplementation((subj: string, handler: any, opts: any) => {
      if (subj === INTERNAL_EGRESS_V1 && opts?.queue?.startsWith('ingress-egress.')) {
        capturedHandler = handler;
      }
      return jest.fn();
    });

    const oldWorkerId = process.env.JEST_WORKER_ID;
    delete process.env.JEST_WORKER_ID;
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      server = new IngressEgressServer();
      await new Promise(resolve => setTimeout(resolve, 50));
    } finally {
      process.env.JEST_WORKER_ID = oldWorkerId;
      process.env.NODE_ENV = oldNodeEnv;
    }

    const mockPublisher = { publishJson: jest.fn() };
    (server as any).getResource = jest.fn().mockImplementation((name: string) => {
      if (name === 'publisher') return { create: jest.fn().mockReturnValue(mockPublisher) };
      return undefined;
    });

    // Mock discordClient to fail
    const mockDiscordClient = { 
      sendText: jest.fn().mockRejectedValue(new Error('Discord API down')),
      getSnapshot: () => ({ state: 'CONNECTED' })
    };
    (server as any).discordClient = mockDiscordClient;

    // Simulate message
    const evt = { 
      v: '2',
      source: 'some-service',
      correlationId: 'c-failed',
      egress: { destination: 'discord' }, 
      payload: { text: 'fail me' }
    };
    
    await capturedHandler(Buffer.from(JSON.stringify(evt)), {}, { ack: jest.fn(), nack: jest.fn() });

    // Verify DLQ
    expect(mockPublisher.publishJson).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'router.deadletter.v1',
        payload: expect.objectContaining({
          reason: 'egress_delivery_failed'
        })
      })
    );
  });
});

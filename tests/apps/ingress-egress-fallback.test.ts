import { IngressEgressServer } from '../../src/apps/ingress-egress-service';
import { INTERNAL_EGRESS_V1 } from '../../src/types/events';

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

describe('IngressEgressServer - User Platform Fallback', () => {
  let server: IngressEgressServer | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    if (server) await server.stop();
    server = undefined;
  });

  it('should fallback to user platform (Discord) if no explicit platform in generic egress', async () => {
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

    // Simulate generic egress message with NO explicit platform, but WITH auth.provider = 'discord'
    const evt = { 
      v: '1',
      source: 'system',
      correlationId: 'c-fallback',
      auth: { provider: 'discord' },
      channel: '12345',
      payload: { text: 'hello fallback' }
    };
    
    await capturedHandler(Buffer.from(JSON.stringify(evt)), {}, { ack: jest.fn(), nack: jest.fn() });

    // EXPECT delivery to Discord
    expect(mockDiscordClient.sendText).toHaveBeenCalledWith('hello fallback', '12345');
  });

  it('should fallback to user platform (Twilio) if no explicit platform in generic egress', async () => {
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

    // Mock twilioClient
    const mockTwilioClient = { 
      sendText: jest.fn().mockResolvedValue(undefined),
      getSnapshot: () => ({ state: 'CONNECTED' })
    };
    (server as any).twilioClient = mockTwilioClient;

    const evt = { 
      v: '1',
      source: 'system',
      correlationId: 'c-fallback-twilio',
      auth: { provider: 'twilio' },
      channel: '+1234567890',
      payload: { text: 'hello twilio fallback' }
    };
    
    await capturedHandler(Buffer.from(JSON.stringify(evt)), {}, { ack: jest.fn(), nack: jest.fn() });

    expect(mockTwilioClient.sendText).toHaveBeenCalledWith('hello twilio fallback', '+1234567890');
  });
});

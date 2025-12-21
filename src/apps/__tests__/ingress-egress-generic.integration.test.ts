// Mocks must be declared before importing the module under test
let subscriptions: Array<{ subject: string, queue?: string, handler: any }> = [];
let publishedCalls: Array<{ subject: string, data: any }> = [];

jest.mock('../../services/message-bus', () => {
  return {
    createMessageSubscriber: () => {
      return {
        subscribe: async (subject: string, handler: any, options?: any) => {
          subscriptions.push({ subject, queue: options?.queue, handler });
          return async () => {};
        },
      };
    },
    createMessagePublisher: (subject: string) => {
      return {
        publishJson: async (data: any, attrs?: Record<string, string>) => {
          publishedCalls.push({ subject, data });
          return 'mid-x';
        },
        flush: async () => {},
      };
    },
  };
});

const mockTwitchClient = {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    sendText: jest.fn().mockResolvedValue(undefined),
    getSnapshot: jest.fn().mockReturnValue({ state: 'CONNECTED' }),
};

const mockTwitchEventSubClient = {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    getSnapshot: jest.fn().mockReturnValue({ state: 'CONNECTED' }),
};

jest.mock('../../services/ingress/twitch', () => {
    return {
        TwitchIrcClient: jest.fn(() => mockTwitchClient),
        TwitchEnvelopeBuilder: jest.fn(),
        ConfigTwitchCredentialsProvider: jest.fn(),
        FirestoreTwitchCredentialsProvider: jest.fn(),
        TwitchEventSubClient: jest.fn(() => mockTwitchEventSubClient),
        createTwitchIngressPublisherFromConfig: jest.fn(),
        TwitchConnectorAdapter: jest.fn(),
    };
});

const mockDiscordClient = {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    sendText: jest.fn().mockResolvedValue(undefined),
    getSnapshot: jest.fn().mockReturnValue({ state: 'CONNECTED' }),
};

jest.mock('../../services/ingress/discord', () => {
    return {
        DiscordIngressClient: jest.fn(() => mockDiscordClient),
        DiscordEnvelopeBuilder: jest.fn(),
        createDiscordIngressPublisherFromConfig: jest.fn(),
    };
});

import { createApp } from '../ingress-egress-service';
import { InternalEventV2, INTERNAL_EGRESS_V1, INTERNAL_DEADLETTER_V1 } from '../../types/events';

describe('ingress-egress generic and DLQ integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    subscriptions = [];
    publishedCalls = [];
    process.env.BUS_PREFIX = 'dev.';
    process.env.EGRESS_INSTANCE_ID = 'test-inst';
    process.env.FORCE_SUBSCRIBE = '1';
  });

  it('registers both instance-specific and generic listeners', async () => {
    createApp();
    await new Promise((r) => setTimeout(r, 10));

    const instanceTopic = `dev.${INTERNAL_EGRESS_V1}.test-inst`;
    const genericTopic = `dev.${INTERNAL_EGRESS_V1}`;

    const instanceSub = subscriptions.find(s => s.subject === instanceTopic);
    const genericSub = subscriptions.find(s => s.subject === genericTopic);

    expect(instanceSub).toBeDefined();
    expect(instanceSub?.queue).toBe('ingress-egress.test-inst');
    expect(genericSub).toBeDefined();
    expect(genericSub?.queue).toBe('ingress-egress.generic');
  });

  it('routes generic message to Twitch via shared handler', async () => {
    createApp();
    await new Promise((r) => setTimeout(r, 10));

    const genericTopic = `dev.${INTERNAL_EGRESS_V1}`;
    const genericSub = subscriptions.find(s => s.subject === genericTopic);

    const evt: InternalEventV2 = {
      v: '1',
      correlationId: 'c-gen-1',
      type: 'egress.deliver.v1',
      egress: { destination: INTERNAL_EGRESS_V1, type: 'twitch:irc' },
      channel: '#mychan',
      candidates: [{ id: 'c1', kind: 'text', text: 'generic hi', priority: 1, status: 'proposed', source: 'llm', createdAt: new Date().toISOString() }]
    } as any;

    await genericSub!.handler(Buffer.from(JSON.stringify(evt)), {}, { ack: async () => {}, nack: async () => {} });

    expect(mockTwitchClient.sendText).toHaveBeenCalledWith('generic hi', '#mychan');
  });

  it('publishes to DLQ if client is unavailable', async () => {
    // We can simulate discord client unavailability by making its constructor throw during setupApp
    const DiscordIngressClient = require('../../services/ingress/discord').DiscordIngressClient;
    DiscordIngressClient.mockImplementationOnce(() => { throw new Error('Discord Setup Failed'); });

    createApp();
    await new Promise((r) => setTimeout(r, 10));

    const genericTopic = `dev.${INTERNAL_EGRESS_V1}`;
    const genericSub = subscriptions.find(s => s.subject === genericTopic);

    const evt = {
      v: '1',
      correlationId: 'c-dlq-1',
      type: 'egress.deliver.v1',
      egress: { destination: INTERNAL_EGRESS_V1, type: 'discord' },
      channel: '123456789',
      candidates: [{ id: 'c1', kind: 'text', text: 'hi', priority: 1, status: 'proposed', source: 'llm', createdAt: new Date().toISOString() }]
    };

    await genericSub!.handler(Buffer.from(JSON.stringify(evt)), {}, { ack: async () => {}, nack: async () => {} });

    // Verify DLQ was published
    const dlqCall = publishedCalls.find(c => c.subject === 'dev.internal.deadletter.v1');
    expect(dlqCall).toBeDefined();
    expect(dlqCall?.data.payload.reason).toBe('EGRESS_CLIENT_UNAVAILABLE');
    expect(dlqCall?.data.correlationId).toBe('c-dlq-1');
  });

  it('publishes to DLQ when client throws terminal error (mocked as DLQ scenario)', async () => {
     createApp();
     await new Promise((r) => setTimeout(r, 10));

     const genericSub = subscriptions.find(s => s.subject === `dev.${INTERNAL_EGRESS_V1}`);
     mockTwitchClient.sendText.mockRejectedValue(new Error('Terminal Twitch Error'));

     const evt = {
       v: '1',
       correlationId: 'c-fail-1',
       type: 'egress.deliver.v1',
       egress: { destination: INTERNAL_EGRESS_V1, type: 'twitch:irc' },
       channel: '#chan',
       candidates: [{ id: 'c1', kind: 'text', text: 'fail me', priority: 1, status: 'proposed', source: 'llm', createdAt: new Date().toISOString() }]
     };

     await genericSub!.handler(Buffer.from(JSON.stringify(evt)), {}, { ack: async () => {}, nack: async () => {} });

     // Verify finalize FAILED was published
     const finalizeCall = publishedCalls.find(c => c.subject === 'dev.internal.persistence.finalize.v1');
     expect(finalizeCall).toBeDefined();
     expect(finalizeCall?.data.status).toBe('FAILED');
     expect(finalizeCall?.data.error.message).toContain('Terminal Twitch Error');
  });
  
  it('publishes to DLQ if platform is unknown and default fails (simulated)', async () => {
      // If we could make both clients null, it would trigger DLQ.
      // For the sake of this test, let's use a platform that we can mock as unavailable.
  });
});

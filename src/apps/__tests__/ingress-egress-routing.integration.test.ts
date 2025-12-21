// Mocks must be declared before importing the module under test
let subscribeSubject: string | undefined;
let handlerFn: ((data: Buffer, attrs: Record<string, string>) => Promise<void>) | undefined;
let publishedCalls: Array<{ subject: string, data: any }> = [];

jest.mock('../../services/message-bus', () => {
  return {
    createMessageSubscriber: () => {
      return {
        subscribe: async (subject: string, handler: any) => {
          subscribeSubject = subject;
          handlerFn = async (data: Buffer, attrs: Record<string, string>) => handler(data, attrs, { ack: async () => {}, nack: async () => {} });
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
import { InternalEventV2 } from '../../types/events';

describe('ingress-egress routing integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    subscribeSubject = undefined;
    handlerFn = undefined;
    publishedCalls = [];
    process.env.BUS_PREFIX = 'dev.';
    process.env.EGRESS_INSTANCE_ID = 'test-inst';
    process.env.FORCE_SUBSCRIBE = '1'; // Enable subscription even in Jest
  });

  it('routes to Discord when egress.type is discord', async () => {
    createApp();
    // Allow async setup
    await new Promise((r) => setTimeout(r, 10));

    const evt: InternalEventV2 = {
      v: '1',
      source: 'ingress.twitch',
      correlationId: 'c-1',
      type: 'egress.deliver.v1',
      egress: { destination: 'dev.internal.egress.v1.test-inst', type: 'discord' },
      channel: '123456789',
      candidates: [
        { id: 'c1', kind: 'text', text: 'hello from discord', priority: 1, status: 'proposed', source: 'llm', createdAt: new Date().toISOString() }
      ]
    } as any;

    await handlerFn!(Buffer.from(JSON.stringify(evt), 'utf8'), {});

    expect(mockDiscordClient.sendText).toHaveBeenCalledWith('hello from discord', '123456789');
  });

  it('routes to Twitch when egress.type is twitch:irc', async () => {
    createApp();
    await new Promise((r) => setTimeout(r, 10));

    const evt: InternalEventV2 = {
      v: '1',
      source: 'ingress.discord',
      correlationId: 'c-2',
      type: 'egress.deliver.v1',
      egress: { destination: 'dev.internal.egress.v1.test-inst', type: 'twitch:irc' },
      channel: '#mychannel',
      candidates: [
        { id: 'c1', kind: 'text', text: 'hello from twitch', priority: 1, status: 'proposed', source: 'llm', createdAt: new Date().toISOString() }
      ]
    } as any;

    await handlerFn!(Buffer.from(JSON.stringify(evt), 'utf8'), {});

    expect(mockTwitchClient.sendText).toHaveBeenCalledWith('hello from twitch', '#mychannel');
  });

  it('falls back to Discord based on source if egress.type is missing', async () => {
    createApp();
    await new Promise((r) => setTimeout(r, 10));

    const evt: InternalEventV2 = {
      v: '1',
      source: 'ingress.discord',
      correlationId: 'c-3',
      type: 'egress.deliver.v1',
      channel: '123456789',
      candidates: [
        { id: 'c1', kind: 'text', text: 'hello fallback', priority: 1, status: 'proposed', source: 'llm', createdAt: new Date().toISOString() }
      ]
    } as any;

    await handlerFn!(Buffer.from(JSON.stringify(evt), 'utf8'), {});

    expect(mockDiscordClient.sendText).toHaveBeenCalledWith('hello fallback', '123456789');
  });
});

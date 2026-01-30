import { IngressEgressServer } from '../ingress-egress-service';
import { BaseServer } from '../../common/base-server';
import { InternalEventV2 } from '../../types/events';

// Mock the twitch client so we can observe calls to sendText
const mockTwitchClient = {
  sendText: jest.fn().mockResolvedValue(undefined),
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  getSnapshot: jest.fn().mockReturnValue({ state: 'CONNECTED' }),
};

const mockTwitchEventSubClient = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  getSnapshot: jest.fn().mockReturnValue({ active: true, subscriptions: 1 }),
};

// We need to bypass the constructor or at least make sure it doesn't fail
jest.mock('../../services/ingress/twitch', () => ({
  ...jest.requireActual('../../services/ingress/twitch'),
  TwitchIrcClient: jest.fn().mockImplementation(() => mockTwitchClient),
  TwitchEventSubClient: jest.fn().mockImplementation(() => mockTwitchEventSubClient),
}));

// Mock the Discord client as well
const mockDiscordClient = {
  sendText: jest.fn().mockResolvedValue(undefined),
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  getSnapshot: jest.fn().mockReturnValue({ state: 'CONNECTED' }),
};

jest.mock('../../services/ingress/discord', () => ({
  ...jest.requireActual('../../services/ingress/discord'),
  DiscordIngressClient: jest.fn().mockImplementation(() => mockDiscordClient),
}));

// Mock the Twilio client
const mockTwilioClient = {
  sendText: jest.fn().mockResolvedValue(undefined),
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  getSnapshot: jest.fn().mockReturnValue({ state: 'CONNECTED' }),
};

jest.mock('../../services/ingress/twilio', () => ({
  ...jest.requireActual('../../services/ingress/twilio'),
  TwilioIngressClient: jest.fn().mockImplementation(() => mockTwilioClient),
  TwilioTokenProvider: jest.fn().mockImplementation(() => ({})),
}));

// Mock message bus to avoid real PubSub in "development" mode simulation
jest.mock('../../services/message-bus', () => ({
  createMessageSubscriber: jest.fn().mockReturnValue({
    subscribe: jest.fn().mockResolvedValue(jest.fn())
  }),
  createMessagePublisher: jest.fn().mockReturnValue({
    publishJson: jest.fn().mockResolvedValue({ messageId: '123' })
  }),
  normalizeAttributes: (a: any) => a
}));

// Mock BaseServer.onMessage
jest.spyOn(BaseServer.prototype as any, 'onMessage');

describe('IngressEgressServer routing', () => {
  let server: IngressEgressServer;

  beforeEach(async () => {
    jest.clearAllMocks();
    
    const oldNodeEnv = process.env.NODE_ENV;
    const oldJestWorkerId = process.env.JEST_WORKER_ID;
    const oldDisable = process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE;
    const oldTwilioEnabled = process.env.TWILIO_ENABLED;

    // Force non-test env for constructor so onMessage is called
    (process.env as any).NODE_ENV = 'development';
    delete process.env.JEST_WORKER_ID;
    process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE = '0';
    process.env.TWILIO_ENABLED = 'true';
    // Provide dummy values for required Twilio secrets to pass config validation
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'auth';
    process.env.TWILIO_API_KEY = 'SK123';
    process.env.TWILIO_API_SECRET = 'secret';
    process.env.TWILIO_CHAT_SERVICE_SID = 'IS123';
    process.env.TWILIO_IDENTITY = 'bot';

    server = new IngressEgressServer();

    // Wait for async setup to finish
    await new Promise(resolve => setTimeout(resolve, 500));

    // Restore
    process.env.NODE_ENV = oldNodeEnv;
    process.env.JEST_WORKER_ID = oldJestWorkerId;
    process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE = oldDisable;
    process.env.TWILIO_ENABLED = oldTwilioEnabled;
  });

  afterEach(async () => {
    if (server) await server.stop();
    delete process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE;
  });

  it('should send Discord responses to Discord instead of Twitch', async () => {
    // Manually trigger the egress handler
    const egressHandler = (server as any).onMessage.mock.calls.find(
      (call: any) => call[0].destination?.startsWith('internal.egress.v1')
    )?.[1];

    if (!egressHandler) {
      throw new Error('Egress handler not found');
    }

    const discordEvent: InternalEventV2 = {
      v: '2',
      correlationId: 'corr-1',
      type: 'chat.message.v1',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'ingress.discord',
        channel: 'discord-channel-1',
      },
      identity: {
        external: { id: 'u1', platform: 'discord' }
      },
      message: {
        id: 'msg-1',
        role: 'assistant',
        text: 'Hello Discord',
      },
      candidates: [
        {
          id: 'cand-1',
          kind: 'text',
          source: 'llm-bot',
          createdAt: new Date().toISOString(),
          status: 'proposed',
          priority: 1,
          text: 'Hello Discord',
        }
      ],
      egress: { destination: 'discord' }
    } as any;

    const ctx = {
      ack: jest.fn().mockResolvedValue(undefined),
      nack: jest.fn().mockResolvedValue(undefined),
    };

    // Execute the handler
    await egressHandler(discordEvent, {}, ctx);

    expect(mockTwitchClient.sendText).not.toHaveBeenCalled();
    expect(mockDiscordClient.sendText).toHaveBeenCalledWith('Hello Discord', 'discord-channel-1');
  });

  it('should route to Discord if source is missing but Discord annotation is present', async () => {
    // Manually trigger the egress handler
    const egressHandler = (server as any).onMessage.mock.calls.find(
      (call: any) => call[0].destination?.startsWith('internal.egress.v1')
    )?.[1];

    const genericEvent: InternalEventV2 = {
      v: '2',
      correlationId: 'corr-3',
      type: 'chat.message.v1',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'llm-bot',
        channel: 'discord-channel-id',
      },
      identity: {
        external: { id: 'u1', platform: 'discord' }
      },
      message: {
        id: 'msg-3',
        role: 'assistant',
        text: 'Command Response',
      },
      annotations: [
        {
          id: 'ann-1',
          kind: 'custom',
          source: 'discord', // Discord annotation!
          createdAt: new Date().toISOString(),
        }
      ],
      candidates: [
        {
          id: 'cand-3',
          kind: 'text',
          source: 'llm-bot',
          createdAt: new Date().toISOString(),
          status: 'proposed',
          priority: 1,
          text: 'Command Response',
        }
      ],
      egress: { destination: 'discord' }
    } as any;

    const ctx = {
      ack: jest.fn().mockResolvedValue(undefined),
      nack: jest.fn().mockResolvedValue(undefined),
    };

    // Execute the handler
    await egressHandler(genericEvent, {}, ctx);

    // Should now route to Discord because of the annotation
    expect(mockTwitchClient.sendText).not.toHaveBeenCalled();
    expect(mockDiscordClient.sendText).toHaveBeenCalledWith('Command Response', 'discord-channel-id');
  });

  it('should route to Discord if it is a V1 event with Discord source', async () => {
    // Manually trigger the egress handler
    const egressHandler = (server as any).onMessage.mock.calls.find(
      (call: any) => call[0].destination?.startsWith('internal.egress.v1')
    )?.[1];

    const v1Event: InternalEventV2 = {
      v: '2',
      correlationId: 'corr-v1',
      type: 'chat.message.v1',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'ingress.discord',
        channel: 'discord-v1-chan',
      },
      identity: {
        external: { id: 'u1', platform: 'discord' }
      },
      payload: {
        text: 'Hello V1 Discord',
      },
      egress: { destination: 'discord' }
    } as any;

    const ctx = {
      ack: jest.fn().mockResolvedValue(undefined),
      nack: jest.fn().mockResolvedValue(undefined),
    };

    // Execute the handler
    await egressHandler(v1Event, {}, ctx);

    expect(mockTwitchClient.sendText).not.toHaveBeenCalled();
    expect(mockDiscordClient.sendText).toHaveBeenCalledWith('Hello V1 Discord', 'discord-v1-chan');
  });

  it('should send Twitch responses to Twitch', async () => {
    // Manually trigger the egress handler
    const egressHandler = (server as any).onMessage.mock.calls.find(
      (call: any) => call[0].destination?.startsWith('internal.egress.v1')
    )?.[1];

    const twitchEvent: InternalEventV2 = {
      v: '2',
      correlationId: 'corr-2',
      type: 'chat.message.v1',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'ingress.twitch',
        channel: '#twitch-channel',
      },
      identity: {
        external: { id: 'u1', platform: 'twitch' }
      },
      message: {
        id: 'msg-2',
        role: 'assistant',
        text: 'Hello Twitch',
      },
      candidates: [
        {
          id: 'cand-2',
          kind: 'text',
          source: 'llm-bot',
          createdAt: new Date().toISOString(),
          status: 'proposed',
          priority: 1,
          text: 'Hello Twitch',
        }
      ],
      egress: { destination: 'twitch' }
    } as any;

    const ctx = {
      ack: jest.fn().mockResolvedValue(undefined),
      nack: jest.fn().mockResolvedValue(undefined),
    };

    // Execute the handler
    await egressHandler(twitchEvent, {}, ctx);

    expect(mockDiscordClient.sendText).not.toHaveBeenCalled();
    expect(mockTwitchClient.sendText).toHaveBeenCalledWith('Hello Twitch', '#twitch-channel');
  });

  it('should send Twilio responses to Twilio', async () => {
    // Manually trigger the egress handler
    const egressHandler = (server as any).onMessage.mock.calls.find(
      (call: any) => call[0].destination?.startsWith('internal.egress.v1')
    )?.[1];

    const twilioEvent: InternalEventV2 = {
      v: '2',
      correlationId: 'corr-twilio',
      type: 'chat.message.v1',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'ingress.twilio',
        channel: 'CH123',
      },
      identity: {
        external: { id: 'u1', platform: 'twilio' }
      },
      message: {
        id: 'msg-twilio',
        role: 'assistant',
        text: 'Hello Twilio',
      },
      candidates: [
        {
          id: 'cand-twilio',
          kind: 'text',
          source: 'llm-bot',
          createdAt: new Date().toISOString(),
          status: 'proposed',
          priority: 1,
          text: 'Hello Twilio',
        }
      ],
      egress: { destination: 'twilio' }
    } as any;

    const ctx = {
      ack: jest.fn().mockResolvedValue(undefined),
      nack: jest.fn().mockResolvedValue(undefined),
    };

    // Execute the handler
    await egressHandler(twilioEvent, {}, ctx);

    expect(mockTwitchClient.sendText).not.toHaveBeenCalled();
    expect(mockDiscordClient.sendText).not.toHaveBeenCalled();
    expect(mockTwilioClient.sendText).toHaveBeenCalledWith('Hello Twilio', 'CH123');
  });
});

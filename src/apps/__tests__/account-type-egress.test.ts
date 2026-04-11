import { IngressEgressServer } from '../src/apps/ingress-egress-service';
import { BaseServer } from '../src/common/base-server';
import { logger } from '../src/common/logging';

// Mock connectors
const mockTwitchBotClient = {
  sendText: jest.fn().mockResolvedValue(undefined),
  getSnapshot: jest.fn().mockReturnValue({ state: 'CONNECTED' }),
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
};

const mockTwitchBroadcasterClient = {
  sendText: jest.fn().mockResolvedValue(undefined),
  getSnapshot: jest.fn().mockReturnValue({ state: 'CONNECTED' }),
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
};

const mockDiscordBotClient = {
  sendText: jest.fn().mockResolvedValue(undefined),
  getSnapshot: jest.fn().mockReturnValue({ state: 'CONNECTED' }),
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
};

const mockDiscordBroadcasterClient = {
  sendText: jest.fn().mockResolvedValue(undefined),
  getSnapshot: jest.fn().mockReturnValue({ state: 'CONNECTED' }),
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
};

// Mock BaseServer
jest.mock('../src/common/base-server', () => {
  return {
    BaseServer: class {
      constructor() {}
      getApp() { return { use: jest.fn() }; }
      getConfig() { return { firestoreEnabled: true }; }
      getResource() { return { create: jest.fn().mockReturnValue({ publishJson: jest.fn() }) }; }
      onMessage() {}
      onHTTPRequest() {}
    }
  };
});

// Mock everything else needed to instantiate IngressEgressServer
jest.mock('../src/services/ingress/twitch', () => ({
  TwitchEnvelopeBuilder: jest.fn(),
  createTwitchIngressPublisherFromConfig: jest.fn(),
  FirestoreTwitchCredentialsProvider: jest.fn(),
  FirestoreTwitchCredentialsProviderV2: jest.fn(),
  TwitchIrcClient: jest.fn().mockImplementation(() => mockTwitchBotClient),
  TwitchEventSubClient: jest.fn(),
  TwitchConnectorAdapter: jest.requireActual('../src/services/ingress/twitch/connector-adapter').TwitchConnectorAdapter,
}));

jest.mock('../src/services/ingress/discord', () => ({
  DiscordEnvelopeBuilder: jest.fn(),
  createDiscordIngressPublisherFromConfig: jest.fn(),
  DiscordIngressClient: jest.fn().mockImplementation(() => mockDiscordBotClient),
}));

jest.mock('../src/services/ingress/twilio', () => ({
  TwilioEnvelopeBuilder: jest.fn(),
  TwilioIngressClient: jest.fn(),
  TwilioTokenProvider: jest.fn(),
  createTwilioIngressPublisherFromConfig: jest.fn(),
}));

describe('accountType metadata reproduction', () => {
  let server: IngressEgressServer;

  beforeEach(() => {
    jest.clearAllMocks();
    server = new IngressEgressServer();
    // Inject mock clients
    (server as any).twitchClient = mockTwitchBotClient;
    (server as any).discordClient = mockDiscordBotClient;
    (server as any).twitchBroadcasterClient = mockTwitchBroadcasterClient;
    (server as any).discordBroadcasterClient = mockDiscordBroadcasterClient;
  });

  it('should use bot account by default when accountType is missing', async () => {
    const evt = {
      correlationId: '123',
      egress: {
        connector: 'twitch',
        channel: '#test',
      },
      payload: { text: 'Hello' }
    };

    await (server as any).processEgress(evt, 'test-topic');
    expect(mockTwitchBotClient.sendText).toHaveBeenCalledWith('Hello', '#test');
  });

  it('should use broadcaster account for Twitch when accountType is broadcaster', async () => {
    const evt = {
      correlationId: '124',
      egress: {
        connector: 'twitch',
        channel: '#test',
        metadata: {
          accountType: 'broadcaster'
        }
      },
      payload: { text: 'Hello from Broadcaster' }
    };

    await (server as any).processEgress(evt, 'test-topic');
    
    expect(mockTwitchBroadcasterClient.sendText).toHaveBeenCalledWith('Hello from Broadcaster', '#test');
    expect(mockTwitchBotClient.sendText).not.toHaveBeenCalled();
  });

  it('should use broadcaster account for Discord when accountType is broadcaster', async () => {
    const evt = {
      correlationId: '125',
      egress: {
        connector: 'discord',
        channel: '123456',
        metadata: {
          accountType: 'broadcaster'
        }
      },
      payload: { text: 'Hello from Discord Broadcaster' }
    };

    await (server as any).processEgress(evt, 'test-topic');
    
    expect(mockDiscordBroadcasterClient.sendText).toHaveBeenCalledWith('Hello from Discord Broadcaster', '123456');
    expect(mockDiscordBotClient.sendText).not.toHaveBeenCalled();
  });

  it('should fail and log error when accountType is invalid', async () => {
    const evt = {
      correlationId: '126',
      egress: {
        connector: 'twitch',
        channel: '#test',
        metadata: {
          accountType: 'invalid'
        }
      },
      payload: { text: 'Hello' }
    };

    const result = await (server as any).processEgress(evt, 'test-topic');
    expect(result).toBe('FAILED');
    expect(mockTwitchBotClient.sendText).not.toHaveBeenCalled();
    expect(mockTwitchBroadcasterClient.sendText).not.toHaveBeenCalled();
  });

  it('should fail and log error when explicitly requested accountType is not configured', async () => {
    (server as any).twitchBroadcasterClient = null;
    const evt = {
      correlationId: '127',
      egress: {
        connector: 'twitch',
        channel: '#test',
        metadata: {
          accountType: 'broadcaster'
        }
      },
      payload: { text: 'Hello' }
    };

    const result = await (server as any).processEgress(evt, 'test-topic');
    expect(result).toBe('FAILED');
  });
});

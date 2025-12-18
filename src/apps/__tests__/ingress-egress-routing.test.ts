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

// We need to bypass the constructor or at least make sure it doesn't fail
jest.mock('../../services/ingress/twitch', () => ({
  ...jest.requireActual('../../services/ingress/twitch'),
  TwitchIrcClient: jest.fn().mockImplementation(() => mockTwitchClient),
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

// Mock BaseServer.onMessage
jest.spyOn(BaseServer.prototype as any, 'onMessage');

describe('IngressEgressServer routing', () => {
  let server: IngressEgressServer;

  beforeEach(async () => {
    jest.clearAllMocks();
    
    const oldNodeEnv = process.env.NODE_ENV;
    const oldJestWorkerId = process.env.JEST_WORKER_ID;
    const oldDisable = process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE;

    // Force non-test env for constructor so onMessage is called
    (process.env as any).NODE_ENV = 'development';
    delete process.env.JEST_WORKER_ID;
    process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE = '0';

    server = new IngressEgressServer();

    // Wait for async setup to finish
    await new Promise(resolve => setTimeout(resolve, 500));

    // Restore
    process.env.NODE_ENV = oldNodeEnv;
    process.env.JEST_WORKER_ID = oldJestWorkerId;
    process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE = oldDisable;
  });

  afterEach(async () => {
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
      v: '1',
      source: 'ingress.discord',
      correlationId: 'corr-1',
      type: 'chat.message.v1',
      channel: 'discord-channel-1',
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
      ]
    } as any;

    const ctx = {
      ack: jest.fn().mockResolvedValue(undefined),
      nack: jest.fn().mockResolvedValue(undefined),
    };

    // Execute the handler
    await egressHandler(discordEvent, {}, ctx);

    // CURRENT BEHAVIOR (BUG): It calls Twitch even for Discord events
    // EXPECTED BEHAVIOR: It should call Discord
    expect(mockTwitchClient.sendText).not.toHaveBeenCalled();
    expect(mockDiscordClient.sendText).toHaveBeenCalledWith('Hello Discord', 'discord-channel-1');
  });

  it('should send Twitch responses to Twitch', async () => {
    // Manually trigger the egress handler
    const egressHandler = (server as any).onMessage.mock.calls.find(
      (call: any) => call[0].destination?.startsWith('internal.egress.v1')
    )?.[1];

    const twitchEvent: InternalEventV2 = {
      v: '1',
      source: 'ingress.twitch',
      correlationId: 'corr-2',
      type: 'chat.message.v1',
      channel: '#twitch-channel',
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
      ]
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
});

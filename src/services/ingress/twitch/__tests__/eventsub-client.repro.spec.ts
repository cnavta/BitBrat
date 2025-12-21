import { TwitchEventSubClient } from '../eventsub-client';
import { ITwitchIngressPublisher } from '../publisher';
import { ITwitchCredentialsProvider } from '../credentials-provider';
import { IConfig } from '../../../../types';

// Mock Twurple
const mockAddUserForToken = jest.fn();
const mockAddUser = jest.fn();
const mockGetAccessTokenForUser = jest.fn();

jest.mock('@twurple/auth', () => ({
  RefreshingAuthProvider: jest.fn().mockImplementation(() => ({
    addUserForToken: mockAddUserForToken,
    addUser: mockAddUser,
    getAccessTokenForUser: mockGetAccessTokenForUser,
    onRefresh: jest.fn(),
  })),
}));

const mockGetUserByName = jest.fn();
const mockOnChannelFollow = jest.fn();
const mockOnChannelUpdate = jest.fn().mockImplementation(async (userId, _handler) => {
  // Simulate Twurple's behavior: it eventually calls apiClient.asUser(broadcasterId)
  await mockAsUser(userId, (ctx: any) => ctx.eventSub.subscribeToChannelUpdateEvents(userId));
});

const mockAsUser = jest.fn().mockImplementation(async (userId, cb) => {
  // Simulate Twurple's internal check: it tries to get a token for the user
  const userFound = mockAddUser.mock.calls.some(call => call[0] === userId);
  if (!userFound) {
    throw new Error(`Tried to make an API call with a user context for user ID ${userId} but no token was found`);
  }
  return cb({
    eventSub: {
      subscribeToChannelUpdateEvents: jest.fn(),
    }
  });
});

jest.mock('@twurple/api', () => ({
  ApiClient: jest.fn().mockImplementation(() => ({
    users: {
      getUserByName: mockGetUserByName,
    },
    asUser: mockAsUser,
  })),
}));

jest.mock('@twurple/eventsub-ws', () => ({
  EventSubWsListener: jest.fn().mockImplementation(() => ({
    onChannelFollow: mockOnChannelFollow,
    onChannelUpdate: mockOnChannelUpdate,
    onStreamOnline: jest.fn(),
    onStreamOffline: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  })),
}));

describe('TwitchEventSubClient Repro', () => {
  let mockPublisher: jest.Mocked<ITwitchIngressPublisher>;
  let mockCredsProvider: jest.Mocked<ITwitchCredentialsProvider>;
  let mockConfig: IConfig;

  const originalEnv = process.env.NODE_ENV;

  afterAll(() => {
    process.env.NODE_ENV = originalEnv;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (process.env as any).NODE_ENV = 'development';
    mockPublisher = {
      publish: jest.fn().mockResolvedValue('mid-123'),
    } as any;

    mockCredsProvider = {
      getChatAuth: jest.fn().mockResolvedValue({
        accessToken: 'mock-token',
        userId: 'bot-id',
        login: 'bot-login',
        refreshToken: 'mock-refresh',
        scope: ['chat', 'moderator:read:followers'],
        expiresIn: 3600,
        obtainmentTimestamp: Date.now(),
      }),
      getBroadcasterAuth: jest.fn().mockResolvedValue(null),
      saveRefreshedToken: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockConfig = {
      twitchClientId: 'mock-client-id',
      twitchClientSecret: 'mock-client-secret',
      twitchEnabled: true,
      busPrefix: 'test.',
    } as any;
  });

  it('correctly uses bot as moderator in onChannelFollow', async () => {
    mockGetUserByName.mockResolvedValue({ id: 'broadcaster-id', name: 'broadcaster' });
    
    const client = new TwitchEventSubClient(mockPublisher, ['broadcaster'], {
      cfg: mockConfig,
      credentialsProvider: mockCredsProvider,
    });

    await client.start();

    // Verify onChannelFollow was called with (broadcaster-id, bot-id)
    expect(mockOnChannelFollow).toHaveBeenCalledWith('broadcaster-id', 'bot-id', expect.any(Function));
  });

  it('uses onChannelUpdate with broadcaster ID', async () => {
    mockGetUserByName.mockResolvedValue({ id: 'broadcaster-id', name: 'broadcaster' });
    
    const client = new TwitchEventSubClient(mockPublisher, ['broadcaster'], {
      cfg: mockConfig,
      credentialsProvider: mockCredsProvider,
    });

    await client.start();

    expect(mockOnChannelUpdate).toHaveBeenCalledWith('broadcaster-id', expect.any(Function));
  });

  it('uses broadcaster token from Firestore when available', async () => {
    mockGetUserByName.mockResolvedValue({ id: 'real-broadcaster-id', name: 'realbroadcaster' });
    (mockCredsProvider.getBroadcasterAuth as jest.Mock).mockResolvedValue({
      accessToken: 'broadcaster-token',
      userId: 'real-broadcaster-id',
      login: 'realbroadcaster',
    });

    const client = new TwitchEventSubClient(mockPublisher, ['realbroadcaster'], {
      cfg: mockConfig,
      credentialsProvider: mockCredsProvider,
    });

    await client.start();

    // Verify broadcaster token was added to authProvider
    expect(mockAddUser).toHaveBeenCalledWith('real-broadcaster-id', expect.objectContaining({
      accessToken: 'broadcaster-token'
    }), expect.any(Array));

    // Verify aliasing was NOT called for this broadcaster (because we have their real token)
    // The first addUser call is for the bot, the second for the broadcaster from getBroadcasterAuth.
    // If aliasing happened, there would be a third call.
    const broadcasterCalls = mockAddUser.mock.calls.filter(call => call[0] === 'real-broadcaster-id');
    expect(broadcasterCalls.length).toBe(1);
  });
});

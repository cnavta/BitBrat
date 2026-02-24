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
const mockOnChannelFollow = jest.fn().mockReturnValue({ stop: jest.fn() });
const mockOnChannelUpdate = jest.fn().mockImplementation((userId, _handler) => {
  // Simulate Twurple's behavior: it eventually calls apiClient.asUser(broadcasterId)
  // We make it sync here to match Twurple's API, but mockAsUser was async.
  // In the real client, this call is internal to Twurple and doesn't block the return of the subscription.
  mockAsUser(userId, (ctx: any) => ctx.eventSub.subscribeToChannelUpdateEvents(userId)).catch(() => {});
  return { stop: jest.fn() };
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

const mockOnStreamOnline = jest.fn().mockReturnValue({ stop: jest.fn() });
const mockOnStreamOffline = jest.fn().mockReturnValue({ stop: jest.fn() });

jest.mock('@twurple/eventsub-ws', () => ({
  EventSubWsListener: jest.fn().mockImplementation(() => ({
    onChannelFollow: mockOnChannelFollow,
    onChannelUpdate: mockOnChannelUpdate,
    onStreamOnline: mockOnStreamOnline,
    onStreamOffline: mockOnStreamOffline,
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

  it('handles stream.online events correctly with startDate', async () => {
    mockGetUserByName.mockResolvedValue({ id: 'broadcaster-id', name: 'broadcaster' });
    
    const client = new TwitchEventSubClient(mockPublisher, ['broadcaster'], {
      cfg: mockConfig,
      credentialsProvider: mockCredsProvider,
    });

    await client.start();

    // Trigger the stream.online handler
    const handler = mockOnStreamOnline.mock.calls[0][1];
    const mockEvent = {
      id: '12345',
      broadcasterId: 'broadcaster-id',
      broadcasterName: 'broadcaster',
      broadcasterDisplayName: 'Broadcaster',
      type: 'live',
      startDate: new Date('2025-12-21T18:29:14.359Z'),
      getStream: jest.fn().mockResolvedValue({
        title: 'Mock Stream',
        gameName: 'Mock Game'
      })
    };

    await handler(mockEvent);

    expect(mockPublisher.publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'system.stream.online',
      externalEvent: expect.objectContaining({
        createdAt: '2025-12-21T18:29:14.359Z',
        metadata: expect.objectContaining({
          startedAt: '2025-12-21T18:29:14.359Z'
        })
      })
    }));
  });

  it('catches and logs errors in EventSub handlers without crashing', async () => {
    mockGetUserByName.mockResolvedValue({ id: 'broadcaster-id', name: 'broadcaster' });
    
    const client = new TwitchEventSubClient(mockPublisher, ['broadcaster'], {
      cfg: mockConfig,
      credentialsProvider: mockCredsProvider,
    });

    await client.start();

    // Trigger handler with bad data that would cause an error if not caught
    const handler = mockOnStreamOnline.mock.calls[0][1];
    
    // We pass an object that doesn't have getStream, which is what currently happens in some tests
    // that haven't been updated for the async enrichment.
    await handler({ id: '123' } as any);

    // If we reach here, it didn't crash.
    // We can also verify that logger.error was called.
  });

  it('provides a compatible snapshot with connection state', async () => {
    mockGetUserByName.mockResolvedValue({ id: 'broadcaster-id', name: 'broadcaster' });
    
    const client = new TwitchEventSubClient(mockPublisher, ['broadcaster'], {
      cfg: mockConfig,
      credentialsProvider: mockCredsProvider,
    });

    // Initial state
    expect(client.getSnapshot().state).toBe('DISCONNECTED');

    await client.start();

    const snapshot = client.getSnapshot();
    expect(snapshot.state).toBe('CONNECTED');
    expect(snapshot.userId).toBe('bot-id');
    expect(snapshot.displayName).toBe('bot-login');
    expect(snapshot.joinedChannels).toContain('#broadcaster');
    expect(snapshot.active).toBe(true);

    await client.stop();
    expect(client.getSnapshot().state).toBe('DISCONNECTED');
  });
});

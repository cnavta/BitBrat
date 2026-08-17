import { SubscriptionManager, SubscriptionStatus } from '../subscription-manager';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { ApiClient } from '@twurple/api';
import { ITwitchIngressPublisher } from '../publisher';
import { MessagePublisher } from '../../../message-bus';
import { SubscriptionConfigLoader, SubscriptionConfig } from '../subscription-config-loader';
import { EventBuilderRegistry } from '../event-builder-registry';

// Mock dependencies
jest.mock('../subscription-config-loader');
jest.mock('../event-builder-registry');

describe('SubscriptionManager', () => {
  let manager: SubscriptionManager;
  let mockListener: jest.Mocked<EventSubWsListener>;
  let mockApiClient: jest.Mocked<ApiClient>;
  let mockPublisher: jest.Mocked<ITwitchIngressPublisher>;
  let mockMutationPublisher: jest.Mocked<MessagePublisher>;
  let mockConfigLoader: jest.Mocked<SubscriptionConfigLoader>;
  let mockRegistry: jest.Mocked<EventBuilderRegistry>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock listener
    mockListener = {
      onChannelFollow: jest.fn(),
      onChannelUpdate: jest.fn(),
      onStreamOnline: jest.fn(),
      onStreamOffline: jest.fn(),
      onChannelRaidTo: jest.fn(),
      onChannelSubscription: jest.fn()
    } as any;

    // Create mock API client
    mockApiClient = {
      getTokenInfo: jest.fn()
    } as any;

    // Create mock publisher
    mockPublisher = {
      publish: jest.fn().mockResolvedValue(undefined)
    } as any;

    // Create mock mutation publisher
    mockMutationPublisher = {
      publishJson: jest.fn().mockResolvedValue(undefined)
    } as any;

    // Mock SubscriptionConfigLoader
    mockConfigLoader = {
      load: jest.fn(),
      reload: jest.fn()
    } as any;

    // Mock EventBuilderRegistry
    mockRegistry = {
      get: jest.fn(),
      has: jest.fn(),
      list: jest.fn().mockReturnValue(['buildFollow', 'buildUpdate', 'buildStreamOnline', 'buildStreamOffline']),
      count: jest.fn().mockReturnValue(4)
    } as any;

    // Mock the constructors
    (SubscriptionConfigLoader as jest.Mock).mockImplementation(() => mockConfigLoader);
    (EventBuilderRegistry as jest.Mock).mockImplementation(() => mockRegistry);

    // Create manager
    manager = new SubscriptionManager(
      mockListener,
      mockApiClient,
      mockPublisher,
      mockMutationPublisher,
      '/test/config.yaml'
    );
  });

  describe('constructor', () => {
    it('should initialize config loader and registry', () => {
      expect(SubscriptionConfigLoader).toHaveBeenCalledWith('/test/config.yaml');
      expect(EventBuilderRegistry).toHaveBeenCalled();
    });

    it('should log initialization', () => {
      // Constructor already called in beforeEach
      expect(mockRegistry.count).toHaveBeenCalled();
      expect(mockRegistry.list).toHaveBeenCalled();
    });
  });

  describe('subscribeChannel()', () => {
    const mockConfig: SubscriptionConfig = {
      version: 1,
      subscriptions: {
        'channel.follow': {
          enabled: true,
          version: 2,
          scope: 'moderator:read:followers',
          priority: 'high',
          builder: 'buildFollow',
          internalType: 'system.twitch.follow'
        },
        'channel.update': {
          enabled: true,
          version: 2,
          priority: 'high',
          builder: 'buildUpdate',
          internalType: 'system.twitch.update'
        },
        'channel.raid': {
          enabled: false, // Disabled
          version: 1,
          priority: 'high',
          builder: 'buildRaid',
          internalType: 'system.twitch.raid'
        }
      },
      channelOverrides: {}
    };

    beforeEach(() => {
      mockConfigLoader.load.mockResolvedValue(mockConfig);
    });

    it('should load config on first call', async () => {
      mockRegistry.get.mockReturnValue(jest.fn());
      mockApiClient.getTokenInfo.mockResolvedValue({
        scopes: ['moderator:read:followers'],
        clientId: 'test'
      } as any);

      await manager.subscribeChannel('bitbrat', 'user123', 'mod456', 'internal.egress.v1');

      expect(mockConfigLoader.load).toHaveBeenCalledTimes(1);
    });

    it('should cache config and not reload on subsequent calls', async () => {
      mockRegistry.get.mockReturnValue(jest.fn());
      mockApiClient.getTokenInfo.mockResolvedValue({
        scopes: ['moderator:read:followers'],
        clientId: 'test'
      } as any);

      await manager.subscribeChannel('bitbrat', 'user123', 'mod456');
      await manager.subscribeChannel('anotherchannel', 'user456', 'mod789');

      expect(mockConfigLoader.load).toHaveBeenCalledTimes(1); // Only once
    });

    it('should skip disabled events', async () => {
      mockRegistry.get.mockReturnValue(jest.fn());
      mockApiClient.getTokenInfo.mockResolvedValue({
        scopes: ['moderator:read:followers'],
        clientId: 'test'
      } as any);

      await manager.subscribeChannel('bitbrat', 'user123', 'mod456');

      // channel.raid is disabled, should not be subscribed
      expect(mockListener.onChannelRaidTo).not.toHaveBeenCalled();
    });

    it('should skip events with missing builders', async () => {
      mockRegistry.get.mockImplementation((name: string) => {
        if (name === 'buildFollow') return null; // Builder not found
        return jest.fn();
      });
      mockApiClient.getTokenInfo.mockResolvedValue({
        scopes: ['moderator:read:followers'],
        clientId: 'test'
      } as any);

      await manager.subscribeChannel('bitbrat', 'user123', 'mod456');

      // channel.follow builder not found, should not subscribe
      expect(mockListener.onChannelFollow).not.toHaveBeenCalled();

      // channel.update should still be subscribed
      expect(mockListener.onChannelUpdate).toHaveBeenCalled();
    });

    it('should skip events with missing OAuth scope', async () => {
      mockRegistry.get.mockReturnValue(jest.fn());
      mockApiClient.getTokenInfo.mockResolvedValue({
        scopes: [], // No scopes
        clientId: 'test'
      } as any);

      await manager.subscribeChannel('bitbrat', 'user123', 'mod456');

      // channel.follow requires moderator:read:followers, should be skipped
      expect(mockListener.onChannelFollow).not.toHaveBeenCalled();

      // channel.update has no scope requirement, should be subscribed
      expect(mockListener.onChannelUpdate).toHaveBeenCalled();
    });

    it('should subscribe to enabled events with valid builders and scopes', async () => {
      const mockFollowBuilder = jest.fn().mockReturnValue({ type: 'system.twitch.follow' });
      const mockUpdateBuilder = jest.fn().mockReturnValue({ type: 'system.twitch.update' });

      mockRegistry.get.mockImplementation((name: string) => {
        if (name === 'buildFollow') return mockFollowBuilder;
        if (name === 'buildUpdate') return mockUpdateBuilder;
        return null;
      });

      mockApiClient.getTokenInfo.mockResolvedValue({
        scopes: ['moderator:read:followers'],
        clientId: 'test'
      } as any);

      await manager.subscribeChannel('bitbrat', 'user123', 'mod456', 'internal.egress.v1');

      expect(mockListener.onChannelFollow).toHaveBeenCalledWith('user123', 'mod456', expect.any(Function));
      expect(mockListener.onChannelUpdate).toHaveBeenCalledWith('user123', expect.any(Function));
    });

    it('should handle subscription errors gracefully', async () => {
      mockRegistry.get.mockReturnValue(jest.fn());
      mockApiClient.getTokenInfo.mockResolvedValue({
        scopes: ['moderator:read:followers'],
        clientId: 'test'
      } as any);

      // Simulate listener method throwing error
      mockListener.onChannelFollow.mockImplementation(() => {
        throw new Error('Subscription failed');
      });

      // Should not throw, just log error
      await expect(manager.subscribeChannel('bitbrat', 'user123', 'mod456')).resolves.not.toThrow();
    });
  });

  describe('scope validation', () => {
    it('should return true if scope is present', async () => {
      mockApiClient.getTokenInfo.mockResolvedValue({
        scopes: ['moderator:read:followers', 'channel:read:subscriptions'],
        clientId: 'test'
      } as any);

      mockConfigLoader.load.mockResolvedValue({
        version: 1,
        subscriptions: {
          'channel.follow': {
            enabled: true,
            scope: 'moderator:read:followers',
            builder: 'buildFollow',
            internalType: 'system.twitch.follow'
          }
        }
      });

      mockRegistry.get.mockReturnValue(jest.fn());

      await manager.subscribeChannel('bitbrat', 'user123', 'mod456');

      expect(mockApiClient.getTokenInfo).toHaveBeenCalled();
    });

    it('should return false if scope is missing', async () => {
      mockApiClient.getTokenInfo.mockResolvedValue({
        scopes: ['channel:read:subscriptions'], // Missing moderator:read:followers
        clientId: 'test'
      } as any);

      mockConfigLoader.load.mockResolvedValue({
        version: 1,
        subscriptions: {
          'channel.follow': {
            enabled: true,
            scope: 'moderator:read:followers',
            builder: 'buildFollow',
            internalType: 'system.twitch.follow'
          }
        }
      });

      mockRegistry.get.mockReturnValue(jest.fn());

      await manager.subscribeChannel('bitbrat', 'user123', 'mod456');

      // Should not subscribe because scope is missing
      expect(mockListener.onChannelFollow).not.toHaveBeenCalled();
    });

    it('should return false on API error (fail-open)', async () => {
      mockApiClient.getTokenInfo.mockRejectedValue(new Error('API error'));

      mockConfigLoader.load.mockResolvedValue({
        version: 1,
        subscriptions: {
          'channel.follow': {
            enabled: true,
            scope: 'moderator:read:followers',
            builder: 'buildFollow',
            internalType: 'system.twitch.follow'
          }
        }
      });

      mockRegistry.get.mockReturnValue(jest.fn());

      await manager.subscribeChannel('bitbrat', 'user123', 'mod456');

      // Should not subscribe because scope validation failed
      expect(mockListener.onChannelFollow).not.toHaveBeenCalled();
    });
  });

  describe('event handlers', () => {
    it('should build and publish InternalEventV2 when event received', async () => {
      const mockBuilder = jest.fn().mockReturnValue({
        type: 'system.twitch.update',
        payload: { test: 'data' }
      });

      mockRegistry.get.mockReturnValue(mockBuilder);
      mockApiClient.getTokenInfo.mockResolvedValue({
        scopes: [],
        clientId: 'test'
      } as any);

      mockConfigLoader.load.mockResolvedValue({
        version: 1,
        subscriptions: {
          'channel.update': {
            enabled: true,
            builder: 'buildUpdate',
            internalType: 'system.twitch.update'
          }
        }
      });

      await manager.subscribeChannel('bitbrat', 'user123', 'mod456', 'internal.egress.v1');

      // Get the event handler
      const handler = mockListener.onChannelUpdate.mock.calls[0][1];

      // Simulate event
      const mockEvent: any = {
        broadcasterId: 'user123',
        broadcasterName: 'bitbrat',
        streamTitle: 'Test Stream'
      };

      await handler(mockEvent);

      // Verify builder was called
      expect(mockBuilder).toHaveBeenCalledWith(mockEvent, {
        finalizationDestination: 'internal.egress.v1'
      });

      // Verify event was published
      expect(mockPublisher.publish).toHaveBeenCalledWith({
        type: 'system.twitch.update',
        payload: { test: 'data' }
      });
    });

    it('should publish mutation if configured', async () => {
      const mockBuilder = jest.fn().mockReturnValue({
        type: 'system.stream.online'
      });

      mockRegistry.get.mockReturnValue(mockBuilder);
      mockApiClient.getTokenInfo.mockResolvedValue({
        scopes: [],
        clientId: 'test'
      } as any);

      mockConfigLoader.load.mockResolvedValue({
        version: 1,
        subscriptions: {
          'stream.online': {
            enabled: true,
            builder: 'buildStreamOnline',
            internalType: 'system.stream.online',
            mutation: {
              key: 'stream.state',
              value: 'on',
              ttl: 21600
            }
          }
        }
      });

      await manager.subscribeChannel('bitbrat', 'user123', 'mod456');

      // Get the event handler
      const handler = mockListener.onStreamOnline.mock.calls[0][1];

      // Simulate event
      const mockEvent: any = {
        id: 'stream123',
        broadcasterId: 'user123',
        broadcasterName: 'bitbrat'
      };

      await handler(mockEvent);

      // Verify mutation was published
      expect(mockMutationPublisher.publishJson).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'set',
          key: 'stream.state',
          value: 'on',
          ttl: 21600,
          reason: 'Twitch EventSub: stream.online'
        })
      );
    });

    it('should not publish mutation if publisher unavailable', async () => {
      const mockBuilder = jest.fn().mockReturnValue({
        type: 'system.stream.online'
      });

      mockRegistry.get.mockReturnValue(mockBuilder);
      mockApiClient.getTokenInfo.mockResolvedValue({
        scopes: [],
        clientId: 'test'
      } as any);

      mockConfigLoader.load.mockResolvedValue({
        version: 1,
        subscriptions: {
          'stream.online': {
            enabled: true,
            builder: 'buildStreamOnline',
            internalType: 'system.stream.online',
            mutation: {
              key: 'stream.state',
              value: 'on'
            }
          }
        }
      });

      // Create manager without mutation publisher
      const managerNoMutation = new SubscriptionManager(
        mockListener,
        mockApiClient,
        mockPublisher,
        null, // No mutation publisher
        '/test/config.yaml'
      );

      await managerNoMutation.subscribeChannel('bitbrat', 'user123', 'mod456');

      // Get the event handler
      const handler = mockListener.onStreamOnline.mock.calls[0][1];

      // Simulate event
      const mockEvent: any = {
        id: 'stream123',
        broadcasterId: 'user123',
        broadcasterName: 'bitbrat'
      };

      // Should not throw
      await expect(handler(mockEvent)).resolves.not.toThrow();

      // Mutation publisher should not be called
      expect(mockMutationPublisher.publishJson).not.toHaveBeenCalled();
    });

    it('should update metrics on successful event processing', async () => {
      const mockBuilder = jest.fn().mockReturnValue({ type: 'system.twitch.update' });

      mockRegistry.get.mockReturnValue(mockBuilder);
      mockApiClient.getTokenInfo.mockResolvedValue({
        scopes: [],
        clientId: 'test'
      } as any);

      mockConfigLoader.load.mockResolvedValue({
        version: 1,
        subscriptions: {
          'channel.update': {
            enabled: true,
            builder: 'buildUpdate',
            internalType: 'system.twitch.update'
          }
        }
      });

      await manager.subscribeChannel('bitbrat', 'user123', 'mod456');

      // Get the event handler
      const handler = mockListener.onChannelUpdate.mock.calls[0][1];

      // Simulate event
      await handler({ broadcasterId: 'user123', broadcasterName: 'bitbrat' } as any);

      // Check status
      const status = manager.getStatus();
      expect(status).toHaveLength(1);
      expect(status[0]).toMatchObject({
        channel: 'bitbrat',
        eventType: 'channel.update',
        status: 'active',
        eventCount: 1,
        errorCount: 0
      });
      expect(status[0].lastEventAt).not.toBeNull();
    });

    it('should update error metrics on handler error', async () => {
      const mockBuilder = jest.fn().mockImplementation(() => {
        throw new Error('Builder error');
      });

      mockRegistry.get.mockReturnValue(mockBuilder);
      mockApiClient.getTokenInfo.mockResolvedValue({
        scopes: [],
        clientId: 'test'
      } as any);

      mockConfigLoader.load.mockResolvedValue({
        version: 1,
        subscriptions: {
          'channel.update': {
            enabled: true,
            builder: 'buildUpdate',
            internalType: 'system.twitch.update'
          }
        }
      });

      await manager.subscribeChannel('bitbrat', 'user123', 'mod456');

      // Get the event handler
      const handler = mockListener.onChannelUpdate.mock.calls[0][1];

      // Simulate event (should not throw)
      await expect(handler({ broadcasterId: 'user123' } as any)).resolves.not.toThrow();

      // Check status
      const status = manager.getStatus();
      expect(status[0]).toMatchObject({
        channel: 'bitbrat',
        eventType: 'channel.update',
        errorCount: 1
      });
      expect(status[0].lastErrorAt).not.toBeNull();
    });
  });

  describe('channel overrides', () => {
    it('should apply channel-specific overrides', async () => {
      mockRegistry.get.mockReturnValue(jest.fn());
      mockApiClient.getTokenInfo.mockResolvedValue({
        scopes: [],
        clientId: 'test'
      } as any);

      mockConfigLoader.load.mockResolvedValue({
        version: 1,
        subscriptions: {
          'channel.raid': {
            enabled: false, // Disabled globally
            builder: 'buildRaid',
            internalType: 'system.twitch.raid'
          }
        },
        channelOverrides: {
          bitbrat: {
            'channel.raid': {
              enabled: true // Enabled for bitbrat
            }
          }
        }
      });

      await manager.subscribeChannel('bitbrat', 'user123', 'mod456');

      // channel.raid should be subscribed for bitbrat due to override
      expect(mockListener.onChannelRaidTo).toHaveBeenCalled();
    });

    it('should not apply overrides for other channels', async () => {
      mockRegistry.get.mockReturnValue(jest.fn());
      mockApiClient.getTokenInfo.mockResolvedValue({
        scopes: [],
        clientId: 'test'
      } as any);

      mockConfigLoader.load.mockResolvedValue({
        version: 1,
        subscriptions: {
          'channel.raid': {
            enabled: false,
            builder: 'buildRaid',
            internalType: 'system.twitch.raid'
          }
        },
        channelOverrides: {
          bitbrat: {
            'channel.raid': {
              enabled: true
            }
          }
        }
      });

      await manager.subscribeChannel('anotherchannel', 'user456', 'mod789');

      // channel.raid should NOT be subscribed for anotherchannel
      expect(mockListener.onChannelRaidTo).not.toHaveBeenCalled();
    });
  });

  describe('getStatus()', () => {
    it('should return empty array when no subscriptions', () => {
      const status = manager.getStatus();
      expect(status).toEqual([]);
    });

    it('should return subscription status after subscribing', async () => {
      mockRegistry.get.mockReturnValue(jest.fn());
      mockApiClient.getTokenInfo.mockResolvedValue({
        scopes: [],
        clientId: 'test'
      } as any);

      mockConfigLoader.load.mockResolvedValue({
        version: 1,
        subscriptions: {
          'channel.update': {
            enabled: true,
            builder: 'buildUpdate',
            internalType: 'system.twitch.update'
          }
        }
      });

      await manager.subscribeChannel('bitbrat', 'user123', 'mod456');

      const status = manager.getStatus();
      expect(status).toHaveLength(1);
      expect(status[0]).toMatchObject({
        channel: 'bitbrat',
        eventType: 'channel.update',
        status: 'active',
        eventCount: 0,
        errorCount: 0
      });
      expect(status[0].createdAt).toBeDefined();
    });
  });

  describe('reloadConfig()', () => {
    it('should reload configuration', async () => {
      const newConfig: SubscriptionConfig = {
        version: 1,
        subscriptions: {
          'channel.update': {
            enabled: true,
            builder: 'buildUpdate',
            internalType: 'system.twitch.update'
          }
        }
      };

      mockConfigLoader.reload.mockResolvedValue(newConfig);

      await manager.reloadConfig();

      expect(mockConfigLoader.reload).toHaveBeenCalled();
    });
  });

  describe('getListenerMethod() mapping', () => {
    it('should map channel.follow correctly', async () => {
      mockRegistry.get.mockReturnValue(jest.fn());
      mockApiClient.getTokenInfo.mockResolvedValue({
        scopes: ['moderator:read:followers'],
        clientId: 'test'
      } as any);

      mockConfigLoader.load.mockResolvedValue({
        version: 1,
        subscriptions: {
          'channel.follow': {
            enabled: true,
            scope: 'moderator:read:followers',
            builder: 'buildFollow',
            internalType: 'system.twitch.follow'
          }
        }
      });

      await manager.subscribeChannel('bitbrat', 'user123', 'mod456');

      expect(mockListener.onChannelFollow).toHaveBeenCalledWith('user123', 'mod456', expect.any(Function));
    });

    it('should pass correct arguments for different event types', async () => {
      mockRegistry.get.mockReturnValue(jest.fn());
      mockApiClient.getTokenInfo.mockResolvedValue({
        scopes: [],
        clientId: 'test'
      } as any);

      mockConfigLoader.load.mockResolvedValue({
        version: 1,
        subscriptions: {
          'channel.update': {
            enabled: true,
            builder: 'buildUpdate',
            internalType: 'system.twitch.update'
          },
          'stream.online': {
            enabled: true,
            builder: 'buildStreamOnline',
            internalType: 'system.stream.online'
          }
        }
      });

      await manager.subscribeChannel('bitbrat', 'user123', 'mod456');

      // channel.update only needs broadcaster user ID
      expect(mockListener.onChannelUpdate).toHaveBeenCalledWith('user123', expect.any(Function));

      // stream.online only needs broadcaster user ID
      expect(mockListener.onStreamOnline).toHaveBeenCalledWith('user123', expect.any(Function));
    });
  });
});

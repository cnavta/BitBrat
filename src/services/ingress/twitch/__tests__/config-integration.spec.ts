import { SubscriptionConfigLoader } from '../subscription-config-loader';
import { EventBuilderRegistry } from '../event-builder-registry';
import path from 'path';
import fs from 'fs/promises';

/**
 * Integration test for config loading and builder registry.
 * Tests the full flow: load config → validate → initialize registry → verify builders.
 *
 * This test uses the REAL config file (not mocked) to ensure end-to-end integration.
 */
describe('Config Integration', () => {
  let loader: SubscriptionConfigLoader;
  let registry: EventBuilderRegistry;
  const configPath = path.join(
    process.cwd(),
    'config/twitch-eventsub/subscriptions.yaml'
  );

  beforeAll(() => {
    loader = new SubscriptionConfigLoader(configPath);
    registry = new EventBuilderRegistry();
  });

  describe('Real config file integration', () => {
    it('should load real config file successfully', async () => {
      // Verify config file exists
      await expect(fs.access(configPath)).resolves.toBeUndefined();

      // Load config
      const config = await loader.load();

      // Validate structure
      expect(config.version).toBe(1);
      expect(config.subscriptions).toBeDefined();
      expect(typeof config.subscriptions).toBe('object');
    });

    it('should have all 4 existing events enabled', async () => {
      const config = await loader.load();

      // These 4 events should be enabled by default
      expect(config.subscriptions['channel.follow'].enabled).toBe(true);
      expect(config.subscriptions['channel.update'].enabled).toBe(true);
      expect(config.subscriptions['stream.online'].enabled).toBe(true);
      expect(config.subscriptions['stream.offline'].enabled).toBe(true);
    });

    it('should have Tier 1 events defined but disabled', async () => {
      const config = await loader.load();

      // Tier 1 events should be defined in config
      const tier1Events = [
        'channel.raid',
        'channel.subscribe',
        'channel.subscription.message',
        'channel.subscription.gift',
        'channel.cheer',
        'channel.channel_points_custom_reward_redemption.add',
        'channel.hype_train.begin',
        'channel.hype_train.progress',
        'channel.hype_train.end',
        'channel.poll.begin',
        'channel.poll.end',
        'channel.prediction.begin',
        'channel.prediction.end'
      ];

      tier1Events.forEach(eventType => {
        expect(config.subscriptions[eventType]).toBeDefined();
        expect(config.subscriptions[eventType].enabled).toBe(false); // Disabled by default
      });
    });

    it('should have valid builder names for all events', async () => {
      const config = await loader.load();

      // All events should have builders matching pattern: build[A-Z][a-zA-Z0-9]*
      Object.entries(config.subscriptions).forEach(([eventType, eventConfig]) => {
        expect(eventConfig.builder).toMatch(/^build[A-Z][a-zA-Z0-9]*$/);
      });
    });

    it('should have valid internal types for all events', async () => {
      const config = await loader.load();

      // All events should have internalType matching pattern: (system|chat).* (allow underscores)
      Object.entries(config.subscriptions).forEach(([eventType, eventConfig]) => {
        expect(eventConfig.internalType).toMatch(/^(system|chat)\.[a-z0-9._]+$/);
      });
    });

    it('should have scopes defined for events that require them', async () => {
      const config = await loader.load();

      // Verify specific scopes
      expect(config.subscriptions['channel.follow'].scope).toBe('moderator:read:followers');
      expect(config.subscriptions['channel.subscribe']?.scope).toBe('channel:read:subscriptions');
      expect(config.subscriptions['channel.cheer']?.scope).toBe('bits:read');

      // Events without special scopes should not have scope field or be undefined
      expect(config.subscriptions['channel.update'].scope).toBeUndefined();
      expect(config.subscriptions['stream.online'].scope).toBeUndefined();
    });

    it('should have mutations defined for stream events', async () => {
      const config = await loader.load();

      // stream.online should have mutation
      expect(config.subscriptions['stream.online'].mutation).toBeDefined();
      expect(config.subscriptions['stream.online'].mutation?.key).toBe('stream.state');
      expect(config.subscriptions['stream.online'].mutation?.value).toBe('on');
      expect(config.subscriptions['stream.online'].mutation?.ttl).toBe(21600);

      // stream.offline should have mutation
      expect(config.subscriptions['stream.offline'].mutation).toBeDefined();
      expect(config.subscriptions['stream.offline'].mutation?.key).toBe('stream.state');
      expect(config.subscriptions['stream.offline'].mutation?.value).toBe('off');
      expect(config.subscriptions['stream.offline'].mutation?.ttl).toBe(21600);
    });
  });

  describe('Config and Registry integration', () => {
    it('should have builders registered for all enabled events', async () => {
      const config = await loader.load();

      // Get all enabled events
      const enabledEvents = Object.entries(config.subscriptions)
        .filter(([_, eventConfig]) => eventConfig.enabled)
        .map(([_, eventConfig]) => eventConfig.builder);

      // All enabled events should have builders in registry
      enabledEvents.forEach(builderName => {
        expect(registry.has(builderName)).toBe(true);
      });
    });

    it('should have 22 builders currently registered (existing + Tier 1 + Tier 2)', () => {
      // 4 existing + 13 Tier 1 + 5 Tier 2 builders (M3 + M4 complete)
      expect(registry.count()).toBe(22);
      expect(registry.list()).toEqual([
        'buildFollow',
        'buildUpdate',
        'buildStreamOnline',
        'buildStreamOffline',
        'buildRaid',
        'buildSubscribe',
        'buildSubscriptionMessage',
        'buildSubscriptionGift',
        'buildCheer',
        'buildChannelPointsRedemption',
        'buildHypeTrainBegin',
        'buildHypeTrainProgress',
        'buildHypeTrainEnd',
        'buildPollBegin',
        'buildPollEnd',
        'buildPredictionBegin',
        'buildPredictionEnd',
        'buildBan',
        'buildUnban',
        'buildModerate',
        'buildChatMessage',
        'buildChatMessageDelete'
      ]);
    });

    it('should have builders for Tier 1 events (M3 complete)', async () => {
      const config = await loader.load();

      // Tier 1 builders SHOULD be registered (M3 complete)
      const tier1Builders = [
        'buildRaid',
        'buildSubscribe',
        'buildSubscriptionMessage',
        'buildSubscriptionGift',
        'buildCheer',
        'buildChannelPointsRedemption',
        'buildHypeTrainBegin',
        'buildHypeTrainProgress',
        'buildHypeTrainEnd',
        'buildPollBegin',
        'buildPollEnd',
        'buildPredictionBegin',
        'buildPredictionEnd'
      ];

      tier1Builders.forEach(builderName => {
        expect(registry.has(builderName)).toBe(true);
      });
    });

    it('should be able to retrieve builders for enabled events', () => {
      const followBuilder = registry.get('buildFollow');
      const updateBuilder = registry.get('buildUpdate');
      const onlineBuilder = registry.get('buildStreamOnline');
      const offlineBuilder = registry.get('buildStreamOffline');

      expect(followBuilder).not.toBeNull();
      expect(updateBuilder).not.toBeNull();
      expect(onlineBuilder).not.toBeNull();
      expect(offlineBuilder).not.toBeNull();
    });

    it('should be able to retrieve Tier 1 builders (M3 complete)', () => {
      const raidBuilder = registry.get('buildRaid');
      const subscribeBuilder = registry.get('buildSubscribe');

      expect(raidBuilder).not.toBeNull();
      expect(subscribeBuilder).not.toBeNull();
    });
  });

  describe('Config caching', () => {
    it('should use cache on subsequent loads', async () => {
      const config1 = await loader.load();
      const config2 = await loader.load();

      // Should be the same instance (cached)
      expect(config1).toBe(config2);
    });

    it('should reload fresh config when reload() is called', async () => {
      const config1 = await loader.load();
      const config2 = await loader.reload();

      // Content should be the same but different instance
      expect(config1).not.toBe(config2);
      expect(config1.version).toBe(config2.version);
      expect(Object.keys(config1.subscriptions).length).toBe(
        Object.keys(config2.subscriptions).length
      );
    });
  });

  describe('channelOverrides', () => {
    it('should have channelOverrides defined (even if empty)', async () => {
      const config = await loader.load();

      // channelOverrides should be defined
      expect(config.channelOverrides).toBeDefined();

      // Default config has empty overrides
      expect(typeof config.channelOverrides).toBe('object');
    });
  });

  describe('Config validation edge cases', () => {
    it('should have at least 4 subscriptions defined', async () => {
      const config = await loader.load();

      const subscriptionCount = Object.keys(config.subscriptions).length;
      expect(subscriptionCount).toBeGreaterThanOrEqual(4);
    });

    it('should have valid priority values', async () => {
      const config = await loader.load();
      const validPriorities = ['critical', 'high', 'medium', 'low'];

      Object.values(config.subscriptions).forEach(eventConfig => {
        if (eventConfig.priority) {
          expect(validPriorities).toContain(eventConfig.priority);
        }
      });
    });

    it('should have all required fields for each subscription', async () => {
      const config = await loader.load();

      Object.entries(config.subscriptions).forEach(([eventType, eventConfig]) => {
        expect(eventConfig.enabled).toBeDefined();
        expect(typeof eventConfig.enabled).toBe('boolean');
        expect(eventConfig.builder).toBeDefined();
        expect(typeof eventConfig.builder).toBe('string');
        expect(eventConfig.internalType).toBeDefined();
        expect(typeof eventConfig.internalType).toBe('string');
      });
    });
  });

  describe('End-to-end flow simulation', () => {
    it('should simulate subscription manager flow: load config → check builder → get builder', async () => {
      // Step 1: Load config
      const config = await loader.load();
      expect(config).toBeDefined();

      // Step 2: Get enabled subscriptions
      const enabledSubscriptions = Object.entries(config.subscriptions)
        .filter(([_, eventConfig]) => eventConfig.enabled);

      expect(enabledSubscriptions.length).toBeGreaterThanOrEqual(4);

      // Step 3: For each enabled subscription, verify builder exists
      enabledSubscriptions.forEach(([eventType, eventConfig]) => {
        const builderName = eventConfig.builder;

        // Check if builder exists
        const hasBuilder = registry.has(builderName);
        expect(hasBuilder).toBe(true);

        // Get builder
        const builder = registry.get(builderName);
        expect(builder).not.toBeNull();
      });
    });
  });
});

import { EventBuilderRegistry, EventBuilderFunction } from '../event-builder-registry';
import { EventSubEnvelopeBuilder } from '../eventsub-envelope-builder';

// Mock the EventSubEnvelopeBuilder
jest.mock('../eventsub-envelope-builder');

describe('EventBuilderRegistry', () => {
  let registry: EventBuilderRegistry;
  let mockBuilder: jest.Mocked<EventSubEnvelopeBuilder>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock builder with all builder methods (existing + Tier 1 + Tier 2)
    mockBuilder = {
      buildFollow: jest.fn(),
      buildUpdate: jest.fn(),
      buildStreamOnline: jest.fn(),
      buildStreamOffline: jest.fn(),
      buildRaid: jest.fn(),
      buildSubscribe: jest.fn(),
      buildSubscriptionMessage: jest.fn(),
      buildSubscriptionGift: jest.fn(),
      buildCheer: jest.fn(),
      buildChannelPointsRedemption: jest.fn(),
      buildHypeTrainBegin: jest.fn(),
      buildHypeTrainProgress: jest.fn(),
      buildHypeTrainEnd: jest.fn(),
      buildPollBegin: jest.fn(),
      buildPollEnd: jest.fn(),
      buildPredictionBegin: jest.fn(),
      buildPredictionEnd: jest.fn(),
      buildBan: jest.fn(),
      buildUnban: jest.fn(),
      buildModerate: jest.fn(),
      buildChatMessage: jest.fn(),
      buildChatMessageDelete: jest.fn()
    } as any;

    // Mock the EventSubEnvelopeBuilder constructor
    (EventSubEnvelopeBuilder as jest.Mock).mockImplementation(() => mockBuilder);

    registry = new EventBuilderRegistry();
  });

  describe('initialization', () => {
    it('should initialize with 22 builders (existing + Tier 1 + Tier 2)', () => {
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

    it('should register all existing and Tier 1 builders', () => {
      expect(registry.has('buildFollow')).toBe(true);
      expect(registry.has('buildUpdate')).toBe(true);
      expect(registry.has('buildStreamOnline')).toBe(true);
      expect(registry.has('buildStreamOffline')).toBe(true);
      expect(registry.has('buildRaid')).toBe(true);
      expect(registry.has('buildSubscribe')).toBe(true);
      expect(registry.has('buildSubscriptionMessage')).toBe(true);
      expect(registry.has('buildSubscriptionGift')).toBe(true);
      expect(registry.has('buildCheer')).toBe(true);
      expect(registry.has('buildChannelPointsRedemption')).toBe(true);
      expect(registry.has('buildHypeTrainBegin')).toBe(true);
      expect(registry.has('buildHypeTrainProgress')).toBe(true);
      expect(registry.has('buildHypeTrainEnd')).toBe(true);
      expect(registry.has('buildPollBegin')).toBe(true);
      expect(registry.has('buildPollEnd')).toBe(true);
      expect(registry.has('buildPredictionBegin')).toBe(true);
      expect(registry.has('buildPredictionEnd')).toBe(true);
    });
  });

  describe('get()', () => {
    it('should return builder function if found', () => {
      const builder = registry.get('buildFollow');
      expect(builder).not.toBeNull();
      expect(typeof builder).toBe('function');
    });

    it('should return null if builder not found', () => {
      const builder = registry.get('buildNonExistent');
      expect(builder).toBeNull();
    });

    it('should return null for empty string', () => {
      const builder = registry.get('');
      expect(builder).toBeNull();
    });

    it('should return correct builder for each registered event', () => {
      const followBuilder = registry.get('buildFollow');
      const updateBuilder = registry.get('buildUpdate');
      const onlineBuilder = registry.get('buildStreamOnline');
      const offlineBuilder = registry.get('buildStreamOffline');

      expect(followBuilder).not.toBeNull();
      expect(updateBuilder).not.toBeNull();
      expect(onlineBuilder).not.toBeNull();
      expect(offlineBuilder).not.toBeNull();

      // Verify they're different functions
      expect(followBuilder).not.toBe(updateBuilder);
      expect(onlineBuilder).not.toBe(offlineBuilder);
    });
  });

  describe('has()', () => {
    it('should return true for existing builders', () => {
      expect(registry.has('buildFollow')).toBe(true);
      expect(registry.has('buildUpdate')).toBe(true);
      expect(registry.has('buildStreamOnline')).toBe(true);
      expect(registry.has('buildStreamOffline')).toBe(true);
    });

    it('should return false for non-existent builders', () => {
      expect(registry.has('buildNonExistent')).toBe(false);
      expect(registry.has('buildFakeEvent')).toBe(false);
      expect(registry.has('buildNotRegistered')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(registry.has('')).toBe(false);
    });

    it('should be case-sensitive', () => {
      expect(registry.has('buildFollow')).toBe(true);
      expect(registry.has('buildfollow')).toBe(false);
      expect(registry.has('BUILDFOLLOW')).toBe(false);
    });
  });

  describe('list()', () => {
    it('should return array of builder names', () => {
      const builders = registry.list();
      expect(Array.isArray(builders)).toBe(true);
      expect(builders.length).toBe(22);
    });

    it('should return all registered builder names', () => {
      const builders = registry.list();
      expect(builders).toContain('buildFollow');
      expect(builders).toContain('buildUpdate');
      expect(builders).toContain('buildStreamOnline');
      expect(builders).toContain('buildStreamOffline');
    });

    it('should return a new array each time (not reference)', () => {
      const list1 = registry.list();
      const list2 = registry.list();

      expect(list1).toEqual(list2);
      expect(list1).not.toBe(list2); // Different array instances
    });
  });

  describe('count()', () => {
    it('should return correct count of registered builders', () => {
      expect(registry.count()).toBe(22);
    });

    it('should return number type', () => {
      expect(typeof registry.count()).toBe('number');
    });
  });

  describe('builder function binding', () => {
    it('should bind builder functions to envelope builder instance', () => {
      const followBuilder = registry.get('buildFollow');

      if (followBuilder) {
        const mockEvent = {
          userId: '12345',
          userName: 'testuser',
          userDisplayName: 'TestUser',
          broadcasterId: '67890',
          broadcasterName: 'broadcaster',
          broadcasterDisplayName: 'Broadcaster',
          followDate: new Date()
        };

        // Call the builder
        followBuilder(mockEvent);

        // Verify the envelope builder method was called
        expect(mockBuilder.buildFollow).toHaveBeenCalledWith(mockEvent);
      }
    });

    it('should pass options to builder functions', () => {
      const onlineBuilder = registry.get('buildStreamOnline');

      if (onlineBuilder) {
        const mockEvent = {
          id: 'stream123',
          broadcasterId: '67890',
          broadcasterName: 'broadcaster',
          broadcasterDisplayName: 'Broadcaster',
          type: 'live',
          startDate: new Date()
        };

        const options = {
          finalizationDestination: 'internal.egress.v1.test'
        };

        // Call the builder with options
        onlineBuilder(mockEvent, options);

        // Verify options were passed
        expect(mockBuilder.buildStreamOnline).toHaveBeenCalledWith(mockEvent, options);
      }
    });
  });

  describe('error handling (fail-open strategy)', () => {
    it('should not throw when getting non-existent builder', () => {
      expect(() => {
        registry.get('buildNonExistent');
      }).not.toThrow();
    });

    it('should return null gracefully for invalid builder names', () => {
      expect(registry.get('invalid-name')).toBeNull();
      expect(registry.get('123')).toBeNull();
      expect(registry.get('build')).toBeNull(); // Just 'build' prefix without name
    });
  });

  describe('extensibility', () => {
    it('should be ready for new builders to be added', () => {
      // Verify registry structure supports future additions
      expect(registry.count()).toBe(22);
      expect(registry.list().length).toBe(22);

      // Tier 1 builders are now registered (M3 complete)
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

      // These should all exist now (M3 complete)
      tier1Builders.forEach(builderName => {
        expect(registry.has(builderName)).toBe(true);
      });
    });
  });

  describe('builder naming conventions', () => {
    it('should have builders following camelCase convention', () => {
      const builders = registry.list();

      builders.forEach(builderName => {
        // Should start with 'build'
        expect(builderName).toMatch(/^build/);

        // Should be camelCase (build + CapitalizedName)
        expect(builderName).toMatch(/^build[A-Z][a-zA-Z0-9]*$/);
      });
    });
  });

  describe('type safety', () => {
    it('should return EventBuilderFunction type or null', () => {
      const builder = registry.get('buildFollow');

      if (builder !== null) {
        // Should be a function
        expect(typeof builder).toBe('function');

        // Bound functions may have length 0, so just verify it's callable
        // and can accept parameters
        const mockEvent = { test: 'data' };
        expect(() => builder(mockEvent)).not.toThrow();
      }
    });
  });
});

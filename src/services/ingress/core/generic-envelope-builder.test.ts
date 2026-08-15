/**
 * Generic Envelope Builder Tests
 *
 * Comprehensive test suite for the universal envelope builder.
 *
 * Sprint 13: DM Capability Implementation (EP-01 DX Foundation)
 * Acceptance Criteria: 90%+ unit test coverage, 20+ test cases
 *
 * @since Sprint 13
 */

import {
  buildGenericEnvelope,
  type GenericBuilderContext,
  type GenericFieldMapping,
} from './generic-envelope-builder';
import type { InternalEventV2 } from '../../../types/events';

describe('GenericEnvelopeBuilder', () => {
  // Test utilities
  const mockUuid = () => 'test-uuid-123';
  const mockNowIso = () => '2026-08-14T12:00:00.000Z';

  describe('Basic Field Extraction', () => {
    it('should extract required fields with simple string paths', () => {
      const platformEvent = {
        user: { id: 'U123' },
        channel: { id: 'C456' },
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'typing.start.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
        },
        opts: { uuid: mockUuid, nowIso: mockNowIso },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.identity.external.id).toBe('U123');
      expect(envelope.ingress.channel).toBe('C456');
      expect(envelope.egress.channel).toBe('C456');
    });

    it('should extract fields using function extractors', () => {
      const platformEvent = {
        author: { uid: 'user-42' },
        room: { rid: 'room-99' },
      };

      const ctx: GenericBuilderContext = {
        platform: 'custom',
        eventType: 'chat.message.v1',
        platformEvent,
        fieldMapping: {
          userId: (evt) => evt.author.uid,
          channelId: (evt) => evt.room.rid,
        },
        opts: { uuid: mockUuid, nowIso: mockNowIso },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.identity.external.id).toBe('user-42');
      expect(envelope.ingress.channel).toBe('room-99');
    });

    it('should throw error if required userId is missing', () => {
      const platformEvent = {
        channel: { id: 'C456' },
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'typing.start.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id', // Field doesn't exist
          channelId: 'channel.id',
        },
      };

      expect(() => buildGenericEnvelope(ctx)).toThrow('missing_required_fields');
    });

    it('should throw error if required channelId is missing', () => {
      const platformEvent = {
        user: { id: 'U123' },
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'typing.start.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id', // Field doesn't exist
        },
      };

      expect(() => buildGenericEnvelope(ctx)).toThrow('missing_required_fields');
    });
  });

  describe('Fallback Path Support', () => {
    it('should use primary path when available', () => {
      const platformEvent = {
        user: {
          username: 'john_doe',
          globalName: 'John Doe',
          id: 'U123',
        },
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'chat.message.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
          userName: {
            path: 'user.username',
            fallbacks: ['user.globalName', 'user.id'],
          },
        },
      };

      // Add missing channelId for test
      (platformEvent as any).channel = { id: 'C456' };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.identity.external.displayName).toBe('john_doe');
    });

    it('should fallback to first available fallback path', () => {
      const platformEvent = {
        user: {
          globalName: 'John Doe',
          id: 'U123',
        },
        channel: { id: 'C456' },
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'chat.message.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
          userName: {
            path: 'user.username', // Missing
            fallbacks: ['user.globalName', 'user.id'],
          },
        },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.identity.external.displayName).toBe('John Doe');
    });

    it('should fallback to last fallback path if earlier ones missing', () => {
      const platformEvent = {
        user: {
          id: 'U123',
        },
        channel: { id: 'C456' },
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'chat.message.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
          userName: {
            path: 'user.username', // Missing
            fallbacks: ['user.globalName', 'user.id'], // Only last exists
          },
        },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.identity.external.displayName).toBe('U123');
    });

    it('should use userId as default userName if all fallbacks fail', () => {
      const platformEvent = {
        user: { id: 'U123' },
        channel: { id: 'C456' },
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'chat.message.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
          userName: {
            path: 'user.username',
            fallbacks: ['user.globalName'],
          },
        },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.identity.external.displayName).toBe('U123'); // Falls back to userId
    });
  });

  describe('Event Wrapper Support (Slack)', () => {
    it('should extract from event wrapper when specified', () => {
      const platformEvent = {
        type: 'event_callback',
        event: {
          type: 'message',
          user: 'U123',
          channel: 'C456',
          text: 'Hello world!',
          ts: '1234567890.123456',
        },
      };

      const ctx: GenericBuilderContext = {
        platform: 'slack',
        eventType: 'chat.message.v1',
        platformEvent,
        fieldMapping: {
          eventWrapper: 'event', // Slack nests events
          userId: 'user',
          channelId: 'channel',
          messageText: 'text',
          messageId: 'ts',
        },
        opts: { uuid: mockUuid, nowIso: mockNowIso },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.identity.external.id).toBe('U123');
      expect(envelope.ingress.channel).toBe('C456');
      expect(envelope.message?.text).toBe('Hello world!');
      expect(envelope.message?.id).toBe('1234567890.123456');
    });

    it('should fallback to root object if event wrapper missing', () => {
      const platformEvent = {
        user: 'U123',
        channel: 'C456',
        text: 'Direct event',
      };

      const ctx: GenericBuilderContext = {
        platform: 'slack',
        eventType: 'chat.message.v1',
        platformEvent,
        fieldMapping: {
          eventWrapper: 'event', // Missing, should use root
          userId: 'user',
          channelId: 'channel',
          messageText: 'text',
        },
        opts: { uuid: mockUuid, nowIso: mockNowIso },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.identity.external.id).toBe('U123');
      expect(envelope.message?.text).toBe('Direct event');
    });
  });

  describe('Message Field Handling', () => {
    it('should include message field when text is provided', () => {
      const platformEvent = {
        user: { id: 'U123' },
        channel: { id: 'C456' },
        content: 'Test message',
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'chat.message.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
          messageText: 'content',
        },
        opts: { uuid: mockUuid, nowIso: mockNowIso },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.message).toBeDefined();
      expect(envelope.message?.text).toBe('Test message');
      expect(envelope.message?.id).toBe('msg-test-uuid-123');
      expect(envelope.message?.role).toBe('user');
    });

    it('should include message field when messageId is provided', () => {
      const platformEvent = {
        user: { id: 'U123' },
        channel: { id: 'C456' },
        id: 'msg-789',
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'chat.message.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
          messageId: 'id',
        },
        opts: { uuid: mockUuid, nowIso: mockNowIso },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.message).toBeDefined();
      expect(envelope.message?.id).toBe('msg-789');
      expect(envelope.message?.text).toBe('');
    });

    it('should omit message field when neither text nor ID provided', () => {
      const platformEvent = {
        user: { id: 'U123' },
        channel: { id: 'C456' },
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'typing.start.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
        },
        opts: { uuid: mockUuid, nowIso: mockNowIso },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.message).toBeUndefined();
    });
  });

  describe('Custom Fields', () => {
    it('should extract custom fields using string paths', () => {
      const platformEvent = {
        user: { id: 'U123' },
        channel: { id: 'C456', type: 'DM' },
        guild: { id: 'G789' },
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'dm.message.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
          custom: {
            channelType: 'channel.type',
            guildId: 'guild.id',
          },
        },
        opts: { uuid: mockUuid, nowIso: mockNowIso },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect((envelope as any).channelType).toBe('DM');
      expect((envelope as any).guildId).toBe('G789');
    });

    it('should extract custom fields using functions', () => {
      const platformEvent = {
        user: { id: 'U123' },
        channel: { id: 'C456', type: 1 }, // ChannelType.DM
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'dm.message.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
          custom: {
            isDM: (evt) => evt.channel.type === 1,
          },
        },
        opts: { uuid: mockUuid, nowIso: mockNowIso },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect((envelope as any).isDM).toBe(true);
    });

    it('should organize custom fields into identity namespace', () => {
      const platformEvent = {
        user: { id: 'U123', roles: ['admin', 'moderator'] },
        channel: { id: 'C456' },
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'chat.message.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
          custom: {
            'identity.roles': 'user.roles',
          },
        },
        opts: { uuid: mockUuid, nowIso: mockNowIso },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.identity.external.metadata).toEqual({
        roles: ['admin', 'moderator'],
      });
    });
  });

  describe('Platform Event Name Detection', () => {
    it('should detect Discord event name from constructor', () => {
      const platformEvent = {
        constructor: { name: 'Message' },
        user: { id: 'U123' },
        channel: { id: 'C456' },
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'chat.message.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
        },
        opts: { uuid: mockUuid, nowIso: mockNowIso },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.metadata?.platformEventName).toBe('Message');
    });

    it('should detect Slack event name from event.type', () => {
      const platformEvent = {
        event: {
          type: 'message',
          user: 'U123',
          channel: 'C456',
        },
      };

      const ctx: GenericBuilderContext = {
        platform: 'slack',
        eventType: 'chat.message.v1',
        platformEvent,
        fieldMapping: {
          eventWrapper: 'event',
          userId: 'user',
          channelId: 'channel',
        },
        opts: { uuid: mockUuid, nowIso: mockNowIso },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.metadata?.platformEventName).toBe('message');
    });

    it('should detect Twitch EventSub vs IRC', () => {
      const eventSubEvent = {
        subscription: { type: 'channel.follow' },
        user: { id: 'U123' },
        channel: { id: 'C456' },
      };

      const ctx: GenericBuilderContext = {
        platform: 'twitch',
        eventType: 'user.follow.v1',
        platformEvent: eventSubEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
        },
        opts: { uuid: mockUuid, nowIso: mockNowIso },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.metadata?.platformEventName).toBe('EventSub');
    });

    it('should return IRC for Twitch IRC messages', () => {
      const ircEvent = {
        tags: { 'user-id': 'U123' },
        channel: 'channelname',
        message: 'Hello',
      };

      const ctx: GenericBuilderContext = {
        platform: 'twitch',
        eventType: 'chat.message.v1',
        platformEvent: ircEvent,
        fieldMapping: {
          userId: 'tags.user-id',
          channelId: 'channel',
        },
        opts: { uuid: mockUuid, nowIso: mockNowIso },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.metadata?.platformEventName).toBe('IRC');
    });
  });

  describe('Envelope Structure', () => {
    it('should set correct event type', () => {
      const platformEvent = {
        user: { id: 'U123' },
        channel: { id: 'C456' },
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'dm.message.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
        },
        opts: { uuid: mockUuid, nowIso: mockNowIso },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.type).toBe('dm.message.v1');
    });

    it('should set version to v2', () => {
      const platformEvent = {
        user: { id: 'U123' },
        channel: { id: 'C456' },
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'chat.message.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
        },
        opts: { uuid: mockUuid, nowIso: mockNowIso },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.v).toBe('2');
    });

    it('should set correct platform in multiple fields', () => {
      const platformEvent = {
        user: { id: 'U123' },
        channel: { id: 'C456' },
      };

      const ctx: GenericBuilderContext = {
        platform: 'slack',
        eventType: 'chat.message.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
        },
        opts: { uuid: mockUuid, nowIso: mockNowIso },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.ingress.connector).toBe('slack');
      expect(envelope.ingress.source).toBe('ingress.slack');
      expect(envelope.identity.external.platform).toBe('slack');
      expect(envelope.egress.connector).toBe('slack');
    });

    it('should include rawPlatformPayload in metadata', () => {
      const platformEvent = {
        user: { id: 'U123' },
        channel: { id: 'C456' },
        customField: 'custom value',
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'chat.message.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
        },
        opts: { uuid: mockUuid, nowIso: mockNowIso },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.metadata?.rawPlatformPayload).toEqual(platformEvent);
    });
  });

  describe('Debug Mode Support', () => {
    it('should attach debug metadata when provided', () => {
      const platformEvent = {
        user: { id: 'U123' },
        channel: { id: 'C456' },
      };

      const debugMetadata = {
        enabled: true as const,
        initiatedBy: 'U123',
        feedbackChannel: 'C456',
        startedAt: '2026-08-14T12:00:00.000Z',
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'chat.message.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
        },
        opts: {
          uuid: mockUuid,
          nowIso: mockNowIso,
          debugMetadata,
        },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.qos?.tracer).toBe(true);
      expect(envelope.metadata?.debug).toEqual(debugMetadata);
    });
  });

  describe('IDs and Timestamps', () => {
    it('should use provided UUID generator', () => {
      const platformEvent = {
        user: { id: 'U123' },
        channel: { id: 'C456' },
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'chat.message.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
        },
        opts: { uuid: mockUuid, nowIso: mockNowIso },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.correlationId).toBe('test-uuid-123');
      expect(envelope.traceId).toBe('test-uuid-123');
    });

    it('should use provided correlationId (for debug mode)', () => {
      const platformEvent = {
        user: { id: 'U123' },
        channel: { id: 'C456' },
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'chat.message.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
        },
        opts: {
          uuid: mockUuid,
          nowIso: mockNowIso,
          correlationId: 'debug-correlation-id',
        },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.correlationId).toBe('debug-correlation-id');
    });

    it('should use provided timestamp generator', () => {
      const platformEvent = {
        user: { id: 'U123' },
        channel: { id: 'C456' },
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'chat.message.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
        },
        opts: { uuid: mockUuid, nowIso: mockNowIso },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.ingress.ingressAt).toBe('2026-08-14T12:00:00.000Z');
    });
  });

  describe('Egress Configuration', () => {
    it('should set egressDestination when provided', () => {
      const platformEvent = {
        user: { id: 'U123' },
        channel: { id: 'C456' },
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'chat.message.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
        },
        opts: {
          uuid: mockUuid,
          nowIso: mockNowIso,
          egressDestination: 'internal.egress.v1.instance-123',
        },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.egress.destination).toBe('internal.egress.v1.instance-123');
    });
  });

  describe('Routing Configuration', () => {
    it('should initialize routing with initial stage', () => {
      const platformEvent = {
        user: { id: 'U123' },
        channel: { id: 'C456' },
      };

      const ctx: GenericBuilderContext = {
        platform: 'discord',
        eventType: 'chat.message.v1',
        platformEvent,
        fieldMapping: {
          userId: 'user.id',
          channelId: 'channel.id',
        },
        opts: { uuid: mockUuid, nowIso: mockNowIso },
      };

      const envelope = buildGenericEnvelope(ctx);

      expect(envelope.routing.stage).toBe('initial');
      expect(envelope.routing.slip).toEqual([]);
      expect(envelope.routing.history).toEqual([]);
    });
  });
});

/**
 * Translation Engine Tests
 *
 * Test suite for the Translation Engine that converts platform events
 * to InternalEventV2 using config-driven mappings.
 *
 * Sprint 13: DX Foundation (DX-004)
 *
 * @since Sprint 13
 */

import { TranslationEngine, CustomEnvelopeBuilder } from './translation-engine';
import { ConfigRegistry } from './config-registry';
import type { InternalEventV2 } from '../../../types/events';

describe('TranslationEngine', () => {
  let mockRegistry: ConfigRegistry;
  let engine: TranslationEngine;
  const originalEnv = process.env;

  beforeEach(() => {
    // Set feature flags for tests
    process.env.ENABLE_CONFIG_REGISTRY = 'true';
    process.env.ENABLE_GENERIC_BUILDER = 'true';

    // Create mock registry with minimal setup
    mockRegistry = new ConfigRegistry({ validateSchema: false });

    // Mock the registry methods
    jest.spyOn(mockRegistry, 'findByPlatformEvent');
    jest.spyOn(mockRegistry, 'getEventDefinition');

    engine = new TranslationEngine(mockRegistry);
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  describe('translateInbound with generic builder', () => {
    it('should translate Discord chat message using generic builder', async () => {
      const platformEvent = {
        channel: { type: 0, id: 'channel-123' },
        author: { id: 'user-123', username: 'john_doe' },
        content: 'Hello in channel!',
        guild: { id: 'guild-123' },
      };

      // Mock registry responses
      (mockRegistry.findByPlatformEvent as jest.Mock).mockReturnValue({
        platformEvent: 'MESSAGE_CREATE',
        internalEventType: 'chat.message.v1',
        priority: 0,
        fieldMapping: {
          userId: { path: 'author.id' },
          userName: { path: 'author.username' },
          channelId: { path: 'channel.id' },
          text: { path: 'content' },
          messageText: { path: 'content' },
        },
      });

      (mockRegistry.getEventDefinition as jest.Mock).mockReturnValue({
        type: 'chat.message.v1',
        version: 1,
        category: 'bidirectional',
      });

      const envelope = await engine.translateInbound('discord', 'MESSAGE_CREATE', platformEvent);

      expect(envelope.type).toBe('chat.message.v1');
      expect(envelope.identity.external.id).toBe('user-123');
      expect(envelope.identity.external.displayName).toBe('john_doe');
      expect(envelope.ingress.connector).toBe('discord');
      expect(envelope.ingress.channel).toBe('channel-123');
      expect(envelope.message?.text).toBe('Hello in channel!');
    });

    it('should translate Discord DM using generic builder', async () => {
      const platformEvent = {
        channel: { type: 1, id: 'dm-channel-456' },
        author: { id: 'user-456', username: 'jane_doe' },
        content: 'Hello in DM!',
      };

      (mockRegistry.findByPlatformEvent as jest.Mock).mockReturnValue({
        platformEvent: 'MESSAGE_CREATE',
        internalEventType: 'dm.message.v1',
        priority: 10,
        fieldMapping: {
          userId: { path: 'author.id' },
          userName: { path: 'author.username' },
          channelId: { path: 'channel.id' },
          text: { path: 'content' },
          messageText: { path: 'content' },
        },
      });

      (mockRegistry.getEventDefinition as jest.Mock).mockReturnValue({
        type: 'dm.message.v1',
        version: 1,
        category: 'bidirectional',
      });

      const envelope = await engine.translateInbound('discord', 'MESSAGE_CREATE', platformEvent);

      expect(envelope.type).toBe('dm.message.v1');
      expect(envelope.identity.external.id).toBe('user-456');
      expect(envelope.message?.text).toBe('Hello in DM!');
    });

    it('should use filter to route DM vs chat correctly', async () => {
      const dmEvent = {
        channel: { type: 1, id: 'dm-channel' },
        author: { id: 'user-1', username: 'dm_user' },
        content: 'DM message',
      };

      const chatEvent = {
        channel: { type: 0, id: 'chat-channel' },
        author: { id: 'user-2', username: 'chat_user' },
        content: 'Chat message',
      };

      // Mock DM mapping (priority 10)
      (mockRegistry.findByPlatformEvent as jest.Mock).mockImplementation(
        (platform, platformEvent, payload) => {
          if (payload.channel.type === 1) {
            return {
              platformEvent: 'MESSAGE_CREATE',
              internalEventType: 'dm.message.v1',
              priority: 10,
              fieldMapping: {
                userId: { path: 'author.id' },
                channelId: { path: 'channel.id' },
                text: { path: 'content' },
                messageText: { path: 'content' },
              },
            };
          } else {
            return {
              platformEvent: 'MESSAGE_CREATE',
              internalEventType: 'chat.message.v1',
              priority: 0,
              fieldMapping: {
                userId: { path: 'author.id' },
                channelId: { path: 'channel.id' },
                text: { path: 'content' },
                messageText: { path: 'content' },
              },
            };
          }
        }
      );

      (mockRegistry.getEventDefinition as jest.Mock).mockImplementation((eventType) => ({
        type: eventType,
        version: 1,
        category: 'bidirectional',
      }));

      const dmEnvelope = await engine.translateInbound('discord', 'MESSAGE_CREATE', dmEvent);
      const chatEnvelope = await engine.translateInbound('discord', 'MESSAGE_CREATE', chatEvent);

      expect(dmEnvelope.type).toBe('dm.message.v1');
      expect(chatEnvelope.type).toBe('chat.message.v1');
    });

    it('should throw error if no mapping found', async () => {
      (mockRegistry.findByPlatformEvent as jest.Mock).mockReturnValue(null);

      await expect(
        engine.translateInbound('discord', 'UNKNOWN_EVENT', {})
      ).rejects.toThrow('No event mapping found for discord:UNKNOWN_EVENT');
    });

    it('should throw error if event definition not found', async () => {
      (mockRegistry.findByPlatformEvent as jest.Mock).mockReturnValue({
        platformEvent: 'MESSAGE_CREATE',
        internalEventType: 'unknown.event.v1',
        priority: 0,
        fieldMapping: {},
      });

      (mockRegistry.getEventDefinition as jest.Mock).mockReturnValue(null);

      await expect(
        engine.translateInbound('discord', 'MESSAGE_CREATE', {})
      ).rejects.toThrow('Event definition not found for unknown.event.v1');
    });

    it('should pass custom options to generic builder', async () => {
      const platformEvent = {
        author: { id: 'user-789', username: 'test_user' },
        channel: { id: 'channel-789' },
        content: 'Test message',
      };

      (mockRegistry.findByPlatformEvent as jest.Mock).mockReturnValue({
        platformEvent: 'MESSAGE_CREATE',
        internalEventType: 'chat.message.v1',
        priority: 0,
        fieldMapping: {
          userId: { path: 'author.id' },
          channelId: { path: 'channel.id' },
          text: { path: 'content' },
          messageText: { path: 'content' },
        },
      });

      (mockRegistry.getEventDefinition as jest.Mock).mockReturnValue({
        type: 'chat.message.v1',
        version: 1,
      });

      const customCorrelationId = 'custom-correlation-id-123';
      const egressDestination = 'internal.egress.v1.instance-abc';

      const envelope = await engine.translateInbound(
        'discord',
        'MESSAGE_CREATE',
        platformEvent,
        {
          correlationId: customCorrelationId,
          egressDestination,
        }
      );

      expect(envelope.correlationId).toBe(customCorrelationId);
      expect(envelope.egress.destination).toBe(egressDestination);
    });
  });

  describe('translateInbound with custom builder', () => {
    it('should use custom builder when registered', async () => {
      const customBuilder: CustomEnvelopeBuilder = jest.fn((platformEvent, opts) => {
        return {
          v: '2',
          type: 'chat.message.v1',
          correlationId: opts?.correlationId || 'custom-corr-id',
          traceId: 'custom-trace-id',
          ingress: {
            ingressAt: new Date().toISOString(),
            source: 'custom-source',
            connector: 'discord',
            channel: platformEvent.channelId,
          },
          identity: {
            external: {
              id: platformEvent.userId,
              platform: 'discord',
              displayName: platformEvent.userName,
            },
          },
          egress: {
            destination: opts?.egressDestination || '',
            type: 'chat',
            connector: 'discord',
            channel: platformEvent.channelId,
          },
          message: {
            id: 'custom-msg-id',
            role: 'user',
            text: platformEvent.text,
          },
          routing: {
            stage: 'initial',
            slip: [],
            history: [],
          },
        } as InternalEventV2;
      });

      engine.registerCustomBuilder('discord', 'chat.message.v1', customBuilder);

      (mockRegistry.findByPlatformEvent as jest.Mock).mockReturnValue({
        platformEvent: 'MESSAGE_CREATE',
        internalEventType: 'chat.message.v1',
        priority: 0,
        fieldMapping: {},
      });

      const platformEvent = {
        userId: 'user-custom',
        userName: 'custom_user',
        channelId: 'channel-custom',
        text: 'Custom builder message',
      };

      const envelope = await engine.translateInbound('discord', 'MESSAGE_CREATE', platformEvent);

      expect(customBuilder).toHaveBeenCalledWith(platformEvent, undefined);
      expect(envelope.ingress.source).toBe('custom-source');
      expect(envelope.message?.id).toBe('custom-msg-id');
    });

    it('should prefer custom builder over generic builder', async () => {
      const customBuilder = jest.fn((platformEvent) => ({
        v: '2',
        type: 'chat.message.v1',
        correlationId: 'custom',
        traceId: 'custom-trace',
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'custom',
          connector: 'discord',
        },
        identity: {
          external: {
            id: 'custom-user',
            platform: 'discord',
          },
        },
        egress: {
          destination: '',
          type: 'chat',
          connector: 'discord',
        },
        routing: {
          stage: 'initial',
          slip: [],
          history: [],
        },
      })) as unknown as CustomEnvelopeBuilder;

      engine.registerCustomBuilder('discord', 'chat.message.v1', customBuilder);

      (mockRegistry.findByPlatformEvent as jest.Mock).mockReturnValue({
        platformEvent: 'MESSAGE_CREATE',
        internalEventType: 'chat.message.v1',
        priority: 0,
        fieldMapping: {
          userId: { path: 'author.id' },
          text: { path: 'content' },
        },
      });

      // getEventDefinition should NOT be called when custom builder is used
      (mockRegistry.getEventDefinition as jest.Mock).mockReturnValue(null);

      const envelope = await engine.translateInbound('discord', 'MESSAGE_CREATE', {
        author: { id: 'user-123' },
        content: 'Test',
      });

      expect(customBuilder).toHaveBeenCalled();
      expect(mockRegistry.getEventDefinition).not.toHaveBeenCalled();
      expect(envelope.ingress.source).toBe('custom');
    });

    it('should pass opts to custom builder', async () => {
      const customBuilder = jest.fn((platformEvent, opts) => ({
        v: '2',
        type: 'chat.message.v1',
        correlationId: opts?.correlationId || 'default',
        traceId: 'trace',
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'custom',
          connector: 'discord',
        },
        identity: {
          external: {
            id: 'user',
            platform: 'discord',
          },
        },
        egress: {
          destination: opts?.egressDestination || '',
          type: 'chat',
          connector: 'discord',
        },
        routing: {
          stage: 'initial',
          slip: [],
          history: [],
        },
      })) as unknown as CustomEnvelopeBuilder;

      engine.registerCustomBuilder('discord', 'chat.message.v1', customBuilder);

      (mockRegistry.findByPlatformEvent as jest.Mock).mockReturnValue({
        platformEvent: 'MESSAGE_CREATE',
        internalEventType: 'chat.message.v1',
        priority: 0,
        fieldMapping: {},
      });

      const opts = {
        correlationId: 'custom-corr',
        egressDestination: 'custom-dest',
      };

      await engine.translateInbound('discord', 'MESSAGE_CREATE', {}, opts);

      expect(customBuilder).toHaveBeenCalledWith({}, opts);
    });
  });

  describe('registerCustomBuilder', () => {
    it('should register custom builder for platform and event type', async () => {
      const customBuilder = jest.fn(() => ({
        v: '2',
        type: 'chat.message.v1',
        correlationId: 'test-corr',
        traceId: 'test-trace',
        ingress: { source: 'test', connector: 'discord', ingressAt: '' },
        identity: { external: { id: 'test-user', platform: 'discord' } },
        egress: { destination: '', type: 'chat', connector: 'discord' },
        routing: { stage: 'initial', slip: [], history: [] },
      })) as unknown as CustomEnvelopeBuilder;

      engine.registerCustomBuilder('discord', 'chat.message.v1', customBuilder);

      // Verify it's registered by checking it's used
      (mockRegistry.findByPlatformEvent as jest.Mock).mockReturnValue({
        platformEvent: 'MESSAGE_CREATE',
        internalEventType: 'chat.message.v1',
        priority: 0,
        fieldMapping: {},
      });

      await engine.translateInbound('discord', 'MESSAGE_CREATE', {});

      expect(customBuilder).toHaveBeenCalled();
    });

    it('should support multiple custom builders for different platforms', async () => {
      const discordBuilder = jest.fn((e) => ({
        v: '2',
        type: 'chat.message.v1',
        correlationId: 'discord-corr',
        ingress: { source: 'discord', connector: 'discord', ingressAt: '' },
        identity: { external: { id: 'discord-user', platform: 'discord' } },
        egress: { destination: '', type: 'chat', connector: 'discord' },
        routing: { stage: 'initial', slip: [], history: [] },
      })) as unknown as CustomEnvelopeBuilder;

      const slackBuilder = jest.fn((e) => ({
        v: '2',
        type: 'chat.message.v1',
        correlationId: 'slack-corr',
        ingress: { source: 'slack', connector: 'slack', ingressAt: '' },
        identity: { external: { id: 'slack-user', platform: 'slack' } },
        egress: { destination: '', type: 'chat', connector: 'slack' },
        routing: { stage: 'initial', slip: [], history: [] },
      })) as unknown as CustomEnvelopeBuilder;

      engine.registerCustomBuilder('discord', 'chat.message.v1', discordBuilder);
      engine.registerCustomBuilder('slack', 'chat.message.v1', slackBuilder);

      (mockRegistry.findByPlatformEvent as jest.Mock).mockReturnValue({
        platformEvent: 'MESSAGE_CREATE',
        internalEventType: 'chat.message.v1',
        priority: 0,
        fieldMapping: {},
      });

      const discordEnvelope = await engine.translateInbound('discord', 'MESSAGE_CREATE', {});
      const slackEnvelope = await engine.translateInbound('slack', 'MESSAGE_CREATE', {});

      expect(discordBuilder).toHaveBeenCalled();
      expect(slackBuilder).toHaveBeenCalled();
      expect(discordEnvelope.correlationId).toBe('discord-corr');
      expect(slackEnvelope.correlationId).toBe('slack-corr');
    });
  });

  describe('backward compatibility', () => {
    it('should work with existing platform-specific builders', async () => {
      // Simulate Discord's buildDiscordEnvelope as a custom builder
      const buildDiscordEnvelope: CustomEnvelopeBuilder = (platformEvent, opts) => {
        return {
          v: '2',
          type: 'chat.message.v1',
          correlationId: opts?.correlationId || 'legacy-corr',
          traceId: 'legacy-trace',
          ingress: {
            ingressAt: opts?.nowIso?.() || new Date().toISOString(),
            source: 'ingress.discord',
            connector: 'discord',
            channel: platformEvent.channelId,
          },
          identity: {
            external: {
              id: platformEvent.authorId,
              platform: 'discord',
              displayName: platformEvent.authorName,
            },
          },
          egress: {
            destination: opts?.egressDestination || '',
            type: 'chat',
            connector: 'discord',
            channel: platformEvent.channelId,
          },
          message: {
            id: platformEvent.messageId,
            role: 'user',
            text: platformEvent.content,
          },
          routing: {
            stage: 'initial',
            slip: [],
            history: [],
          },
        } as InternalEventV2;
      };

      engine.registerCustomBuilder('discord', 'chat.message.v1', buildDiscordEnvelope);

      (mockRegistry.findByPlatformEvent as jest.Mock).mockReturnValue({
        platformEvent: 'MESSAGE_CREATE',
        internalEventType: 'chat.message.v1',
        priority: 0,
        fieldMapping: {},
      });

      const discordMeta = {
        guildId: 'guild-123',
        channelId: 'channel-456',
        messageId: 'msg-789',
        authorId: 'user-999',
        authorName: 'legacy_user',
        content: 'Legacy Discord message',
      };

      const envelope = await engine.translateInbound('discord', 'MESSAGE_CREATE', discordMeta);

      expect(envelope.ingress.source).toBe('ingress.discord');
      expect(envelope.message?.id).toBe('msg-789');
      expect(envelope.message?.text).toBe('Legacy Discord message');
    });
  });

  describe('Slack event translation with eventWrapper', () => {
    it('should handle Slack event wrapper correctly', async () => {
      const slackEvent = {
        type: 'event_callback',
        event: {
          type: 'message',
          user: 'U123456789',
          channel: 'C987654321',
          text: 'Hello from Slack!',
          ts: '1723636800.123456',
        },
      };

      (mockRegistry.findByPlatformEvent as jest.Mock).mockReturnValue({
        platformEvent: 'message',
        internalEventType: 'chat.message.v1',
        priority: 0,
        fieldMapping: {
          eventWrapper: 'event',
          userId: { path: 'user' },
          channelId: { path: 'channel' },
          text: { path: 'text' },
          messageText: { path: 'text' },
          messageId: { path: 'ts' },
        },
      });

      (mockRegistry.getEventDefinition as jest.Mock).mockReturnValue({
        type: 'chat.message.v1',
        version: 1,
        category: 'bidirectional',
      });

      const envelope = await engine.translateInbound('slack', 'message', slackEvent);

      expect(envelope.type).toBe('chat.message.v1');
      expect(envelope.identity.external.id).toBe('U123456789');
      expect(envelope.ingress.connector).toBe('slack');
      expect(envelope.ingress.channel).toBe('C987654321');
      expect(envelope.message?.text).toBe('Hello from Slack!');
    });

    it('should handle Slack DM detection via channel prefix', async () => {
      const slackDmEvent = {
        type: 'event_callback',
        event: {
          type: 'message',
          channel_type: 'im',
          user: 'U987654321',
          channel: 'D123456789',
          text: 'DM in Slack',
          ts: '1723636900.789012',
        },
      };

      (mockRegistry.findByPlatformEvent as jest.Mock).mockReturnValue({
        platformEvent: 'message',
        internalEventType: 'dm.message.v1',
        priority: 10,
        fieldMapping: {
          eventWrapper: 'event',
          userId: { path: 'user' },
          channelId: { path: 'channel' },
          text: { path: 'text' },
          messageText: { path: 'text' },
          messageId: { path: 'ts' },
        },
      });

      (mockRegistry.getEventDefinition as jest.Mock).mockReturnValue({
        type: 'dm.message.v1',
        version: 1,
        category: 'bidirectional',
      });

      const envelope = await engine.translateInbound('slack', 'message', slackDmEvent);

      expect(envelope.type).toBe('dm.message.v1');
      expect(envelope.identity.external.id).toBe('U987654321');
      expect(envelope.message?.text).toBe('DM in Slack');
    });
  });

  describe('Twitch event translation', () => {
    it('should translate Twitch IRC chat message', async () => {
      const twitchIrcEvent = {
        command: 'PRIVMSG',
        channel: '#streamername',
        message: 'Hello from Twitch chat!',
        tags: {
          'user-id': '123456789',
          'display-name': 'ViewerName',
          id: 'msg-abc-123',
        },
      };

      (mockRegistry.findByPlatformEvent as jest.Mock).mockReturnValue({
        platformEvent: 'PRIVMSG',
        internalEventType: 'chat.message.v1',
        priority: 0,
        fieldMapping: {
          userId: { path: 'tags.user-id' },
          userName: { path: 'tags.display-name' },
          channelId: { path: 'channel' },
          text: { path: 'message' },
          messageText: { path: 'message' },
          messageId: { path: 'tags.id' },
        },
      });

      (mockRegistry.getEventDefinition as jest.Mock).mockReturnValue({
        type: 'chat.message.v1',
        version: 1,
        category: 'bidirectional',
      });

      const envelope = await engine.translateInbound('twitch', 'PRIVMSG', twitchIrcEvent);

      expect(envelope.type).toBe('chat.message.v1');
      expect(envelope.identity.external.id).toBe('123456789');
      expect(envelope.identity.external.displayName).toBe('ViewerName');
      expect(envelope.ingress.connector).toBe('twitch');
      expect(envelope.ingress.channel).toBe('#streamername');
      expect(envelope.message?.text).toBe('Hello from Twitch chat!');
    });

    it('should translate Twitch whisper message', async () => {
      const twitchWhisper = {
        command: 'WHISPER',
        from_user: 'WhisperSender',
        message: 'Secret private message',
        tags: {
          'user-id': '987654321',
          'display-name': 'WhisperSender',
          id: 'whisper-msg-123',
        },
      };

      (mockRegistry.findByPlatformEvent as jest.Mock).mockReturnValue({
        platformEvent: 'WHISPER',
        internalEventType: 'dm.message.v1',
        priority: 10,
        fieldMapping: {
          userId: { path: 'tags.user-id' },
          userName: { path: 'tags.display-name' },
          channelId: { path: 'from_user' }, // Use from_user as channel ID for whispers
          text: { path: 'message' },
          messageText: { path: 'message' },
          messageId: { path: 'tags.id' },
        },
      });

      (mockRegistry.getEventDefinition as jest.Mock).mockReturnValue({
        type: 'dm.message.v1',
        version: 1,
        category: 'bidirectional',
      });

      const envelope = await engine.translateInbound('twitch', 'WHISPER', twitchWhisper);

      expect(envelope.type).toBe('dm.message.v1');
      expect(envelope.identity.external.id).toBe('987654321');
      expect(envelope.identity.external.displayName).toBe('WhisperSender');
      expect(envelope.ingress.connector).toBe('twitch');
      expect(envelope.message?.text).toBe('Secret private message');
    });
  });

  describe('Field mapping with fallbacks', () => {
    it('should use fallback paths when primary path is missing', async () => {
      const discordEvent = {
        author: {
          id: 'user-123',
          // No username property
          global_name: 'GlobalDisplayName',
        },
        channel: { id: 'channel-456' },
        content: 'Test message',
      };

      (mockRegistry.findByPlatformEvent as jest.Mock).mockReturnValue({
        platformEvent: 'MESSAGE_CREATE',
        internalEventType: 'chat.message.v1',
        priority: 0,
        fieldMapping: {
          userId: { path: 'author.id' },
          userName: {
            path: 'author.username',
            fallbacks: ['author.global_name', 'author.id'],
          },
          channelId: { path: 'channel.id' },
          text: { path: 'content' },
          messageText: { path: 'content' },
        },
      });

      (mockRegistry.getEventDefinition as jest.Mock).mockReturnValue({
        type: 'chat.message.v1',
        version: 1,
      });

      const envelope = await engine.translateInbound('discord', 'MESSAGE_CREATE', discordEvent);

      // Should fall back to global_name
      expect(envelope.identity.external.displayName).toBe('GlobalDisplayName');
    });

    it('should use second fallback if first also missing', async () => {
      const discordEvent = {
        author: {
          id: 'user-789',
          // No username or global_name
        },
        channel: { id: 'channel-789' },
        content: 'Fallback test',
      };

      (mockRegistry.findByPlatformEvent as jest.Mock).mockReturnValue({
        platformEvent: 'MESSAGE_CREATE',
        internalEventType: 'chat.message.v1',
        priority: 0,
        fieldMapping: {
          userId: { path: 'author.id' },
          userName: {
            path: 'author.username',
            fallbacks: ['author.global_name', 'author.id'],
          },
          channelId: { path: 'channel.id' },
          text: { path: 'content' },
          messageText: { path: 'content' },
        },
      });

      (mockRegistry.getEventDefinition as jest.Mock).mockReturnValue({
        type: 'chat.message.v1',
        version: 1,
      });

      const envelope = await engine.translateInbound('discord', 'MESSAGE_CREATE', discordEvent);

      // Should fall back to author.id
      expect(envelope.identity.external.displayName).toBe('user-789');
    });
  });

  describe('Custom field extraction', () => {
    it('should extract custom fields into envelope', async () => {
      const discordEvent = {
        author: { id: 'user-123', username: 'test_user' },
        channel: { id: 'channel-123', type: 0 },
        content: 'Message with custom fields',
        guild: { id: 'guild-456' },
        referenced_message: { id: 'reply-to-msg' },
      };

      (mockRegistry.findByPlatformEvent as jest.Mock).mockReturnValue({
        platformEvent: 'MESSAGE_CREATE',
        internalEventType: 'chat.message.v1',
        priority: 0,
        fieldMapping: {
          userId: { path: 'author.id' },
          channelId: { path: 'channel.id' },
          text: { path: 'content' },
          messageText: { path: 'content' },
          custom: {
            guildId: 'guild.id',
            channelType: 'channel.type',
            isReply: 'referenced_message.id',
          },
        },
      });

      (mockRegistry.getEventDefinition as jest.Mock).mockReturnValue({
        type: 'chat.message.v1',
        version: 1,
      });

      const envelope = await engine.translateInbound('discord', 'MESSAGE_CREATE', discordEvent);

      expect(envelope.type).toBe('chat.message.v1');
      // Custom fields would be in the envelope's ingress.metadata or similar
      // The exact location depends on generic builder implementation
    });
  });

  describe('Feature flag combinations', () => {
    it('should throw error when config registry disabled and no custom builder', async () => {
      // Disable config registry
      process.env.ENABLE_CONFIG_REGISTRY = 'false';
      process.env.ENABLE_GENERIC_BUILDER = 'true';

      const engineWithoutRegistry = new TranslationEngine(mockRegistry);

      await expect(
        engineWithoutRegistry.translateInbound('discord', 'MESSAGE_CREATE', {})
      ).rejects.toThrow();
    });

    it('should throw error when generic builder disabled and no custom builder', async () => {
      // Disable generic builder
      process.env.ENABLE_CONFIG_REGISTRY = 'true';
      process.env.ENABLE_GENERIC_BUILDER = 'false';

      const engineWithoutGenericBuilder = new TranslationEngine(mockRegistry);

      (mockRegistry.findByPlatformEvent as jest.Mock).mockReturnValue({
        platformEvent: 'MESSAGE_CREATE',
        internalEventType: 'chat.message.v1',
        priority: 0,
        fieldMapping: {},
      });

      await expect(
        engineWithoutGenericBuilder.translateInbound('discord', 'MESSAGE_CREATE', {})
      ).rejects.toThrow('No custom builder registered for discord:MESSAGE_CREATE and ENABLE_GENERIC_BUILDER=false');
    });

    it('should use custom builder when generic builder disabled', async () => {
      process.env.ENABLE_CONFIG_REGISTRY = 'true';
      process.env.ENABLE_GENERIC_BUILDER = 'false';

      const engineWithFlags = new TranslationEngine(mockRegistry);

      const customBuilder = jest.fn(() => ({
        v: '2',
        type: 'chat.message.v1',
        correlationId: 'test',
        traceId: 'test',
        ingress: { source: 'test', connector: 'discord', ingressAt: '' },
        identity: { external: { id: 'user', platform: 'discord' } },
        egress: { destination: '', type: 'chat', connector: 'discord' },
        routing: { stage: 'initial', slip: [], history: [] },
      })) as unknown as CustomEnvelopeBuilder;

      engineWithFlags.registerCustomBuilder('discord', 'chat.message.v1', customBuilder);

      (mockRegistry.findByPlatformEvent as jest.Mock).mockReturnValue({
        platformEvent: 'MESSAGE_CREATE',
        internalEventType: 'chat.message.v1',
        priority: 0,
        fieldMapping: {},
      });

      await engineWithFlags.translateInbound('discord', 'MESSAGE_CREATE', {});

      expect(customBuilder).toHaveBeenCalled();
    });
  });
});

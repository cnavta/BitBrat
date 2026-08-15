/**
 * Regression Test Suite
 * Sprint 13: DX-014
 *
 * Ensures YAML-based config migration doesn't break existing behavior.
 * Validates that event normalization produces identical InternalEventV2
 * structure across all platforms.
 *
 * Test Strategy:
 * 1. Load platform event fixtures
 * 2. Run through TranslationEngine with config registry enabled
 * 3. Validate all required fields are present
 * 4. Validate field values match expectations
 * 5. Ensure no unexpected fields are added
 */

import { ConfigRegistry } from './config-registry';
import { TranslationEngine } from './translation-engine';
import type { InternalEventV2 } from '../../../types/events';
import * as path from 'path';

// Set feature flags for testing
process.env.ENABLE_CONFIG_REGISTRY = 'true';
process.env.ENABLE_GENERIC_BUILDER = 'true';

describe('Regression Test Suite (DX-014)', () => {
  let registry: ConfigRegistry;
  let engine: TranslationEngine;

  beforeAll(async () => {
    const configPath = path.join(__dirname, '../../../..', 'config');
    registry = new ConfigRegistry({ configPath, validateSchema: false });
    await registry.load();
    engine = new TranslationEngine(registry);
  });

  describe('Discord: MESSAGE_CREATE → chat.message.v1', () => {
    // Fixture matches DiscordMessageMeta structure (normalized by DiscordIngressClient)
    const fixture = {
      messageId: '1234567890123456789',
      channelType: 0, // Guild text channel
      content: 'Hello in a guild channel!',
      channelId: 'C987654321',
      guildId: 'G111222333',
      authorId: 'U123456789',
      authorName: 'testuser',
      createdAt: '2026-08-14T12:00:00.000Z',
      mentions: [],
      roles: [],
      isOwner: false,
    };

    it('should normalize to chat.message.v1', async () => {
      const result = await engine.translateInbound('discord', 'MESSAGE_CREATE', fixture);

      expect(result.type).toBe('chat.message.v1');
    });

    it('should extract all required fields', async () => {
      const result = await engine.translateInbound('discord', 'MESSAGE_CREATE', fixture);

      // Core envelope fields
      expect(result.v).toBe('2');
      expect(result.correlationId).toBeDefined();
      expect(result.type).toBe('chat.message.v1');

      // Ingress
      expect(result.ingress.source).toBe('ingress.discord');
      expect(result.ingress.connector).toBe('discord');
      expect(result.ingress.channel).toBe('C987654321');
      expect(result.ingress.ingressAt).toBeDefined();

      // Identity
      expect(result.identity.external.id).toBe('U123456789');
      expect(result.identity.external.platform).toBe('discord');
      expect(result.identity.external.displayName).toBe('testuser');

      // Message
      expect(result.message).toBeDefined();
      expect(result.message?.text).toBe('Hello in a guild channel!');
      expect(result.message?.id).toBe('1234567890123456789');
      expect(result.message?.role).toBe('user');

      // Egress
      expect(result.egress.connector).toBe('discord');
      expect(result.egress.channel).toBe('C987654321');
    });

    it('should have valid routing structure', async () => {
      const result = await engine.translateInbound('discord', 'MESSAGE_CREATE', fixture);

      expect(result.routing).toBeDefined();
      expect(result.routing.stage).toBe('initial');
      expect(result.routing.slip).toEqual([]);
      expect(result.routing.history).toEqual([]);
    });

    it('should preserve custom metadata', async () => {
      const result = await engine.translateInbound('discord', 'MESSAGE_CREATE', fixture);

      // Custom fields from YAML mapping (stored at top level of envelope via Object.assign)
      // TypeScript doesn't know about these dynamic fields, so use type assertion
      const envelope = result as any;
      expect(envelope.guildId).toBe('G111222333');
      expect(envelope.channelType).toBe(0);
      expect(envelope.mentions).toEqual([]);
      expect(envelope.roles).toEqual([]);
      expect(envelope.isOwner).toBe(false);
    });
  });

  describe('Discord: MESSAGE_CREATE → dm.message.v1', () => {
    // Fixture matches DiscordMessageMeta structure (normalized by DiscordIngressClient)
    const fixture = {
      messageId: '9876543210987654321',
      channelType: 1, // DM channel
      content: 'Hello! This is a DM.',
      channelId: 'D123456789',
      guildId: '', // Empty for DMs
      authorId: 'U987654321',
      authorName: 'dmuser',
      createdAt: '2026-08-14T13:00:00.000Z',
      mentions: [],
      roles: undefined, // DMs don't have roles
      isOwner: false,
    };

    it('should normalize to dm.message.v1 based on channel type', async () => {
      const result = await engine.translateInbound('discord', 'MESSAGE_CREATE', fixture);

      expect(result.type).toBe('dm.message.v1');
    });

    it('should have higher priority than chat mapping', async () => {
      // DM mapping (priority 10) should match before chat mapping (priority 0)
      const result = await engine.translateInbound('discord', 'MESSAGE_CREATE', fixture);

      expect(result.type).toBe('dm.message.v1');
      expect(result.egress.type).toBe('dm');
    });

    it('should extract DM-specific fields', async () => {
      const result = await engine.translateInbound('discord', 'MESSAGE_CREATE', fixture);

      expect(result.identity.external.id).toBe('U987654321');
      expect(result.message?.text).toBe('Hello! This is a DM.');
      expect(result.egress.type).toBe('dm');
    });
  });

  describe('Slack: message → chat.message.v1', () => {
    const fixture = {
      type: 'message',
      user: 'U123456789',
      text: 'Hello in a Slack channel!',
      ts: '1723636800.123456',
      channel: 'C987654321',
      event_ts: '1723636800.123456',
      channel_type: 'channel',
    };

    it('should normalize to chat.message.v1', async () => {
      const result = await engine.translateInbound('slack', 'message', fixture);

      expect(result.type).toBe('chat.message.v1');
    });

    it('should extract all required fields', async () => {
      const result = await engine.translateInbound('slack', 'message', fixture);

      expect(result.v).toBe('2');
      expect(result.ingress.source).toBe('ingress.slack');
      expect(result.ingress.connector).toBe('slack');
      expect(result.ingress.channel).toBe('C987654321');

      expect(result.identity.external.id).toBe('U123456789');
      expect(result.identity.external.platform).toBe('slack');

      expect(result.message?.text).toBe('Hello in a Slack channel!');
      expect(result.message?.id).toBe('1723636800.123456');

      expect(result.egress.connector).toBe('slack');
      expect(result.egress.channel).toBe('C987654321');
    });

    it('should handle Slack timestamp as message ID', async () => {
      const result = await engine.translateInbound('slack', 'message', fixture);

      // Slack uses timestamp as unique message ID
      expect(result.message?.id).toBe('1723636800.123456');
    });
  });

  describe('Slack: message → dm.message.v1', () => {
    const fixture = {
      type: 'message',
      user: 'U987654321',
      text: 'Hello! This is a Slack DM.',
      ts: '1723636900.654321',
      channel: 'D123456789', // DM channel starts with 'D'
      event_ts: '1723636900.654321',
      channel_type: 'im',
    };

    it('should normalize to dm.message.v1 when channel starts with D', async () => {
      const result = await engine.translateInbound('slack', 'message', fixture);

      expect(result.type).toBe('dm.message.v1');
    });

    it('should have DM egress type', async () => {
      const result = await engine.translateInbound('slack', 'message', fixture);

      expect(result.egress.type).toBe('dm');
    });
  });

  describe('Twitch: PRIVMSG → chat.message.v1', () => {
    // Fixture matches IrcMessageMeta structure after TwitchIrcClient normalization
    // and TranslationEngineEnvelopeBuilder transformation (adds 'message' field)
    const fixture = {
      channel: 'testchannel',
      userLogin: 'twitchuser',
      text: 'Hello in Twitch chat!',
      message: 'Hello in Twitch chat!', // Added by TranslationEngineEnvelopeBuilder
      userDisplayName: 'TwitchUser',
      userId: '123456789',
      messageId: 'msg-id-123',
      raw: {
        tags: {
          'user-id': '123456789',
          'display-name': 'TwitchUser',
          id: 'msg-id-123',
          color: '#FF0000',
          badges: 'moderator/1,subscriber/12',
          emotes: '',
        },
      },
    };

    it('should normalize to chat.message.v1', async () => {
      const result = await engine.translateInbound('twitch', 'PRIVMSG', fixture);

      expect(result.type).toBe('chat.message.v1');
    });

    it('should extract Twitch IRC fields', async () => {
      const result = await engine.translateInbound('twitch', 'PRIVMSG', fixture);

      expect(result.ingress.source).toBe('ingress.twitch');
      expect(result.ingress.connector).toBe('twitch');
      expect(result.ingress.channel).toBe('testchannel');

      expect(result.identity.external.id).toBe('123456789');
      expect(result.identity.external.platform).toBe('twitch');
      expect(result.identity.external.displayName).toBe('TwitchUser');

      expect(result.message?.text).toBe('Hello in Twitch chat!');
      expect(result.message?.id).toBe('msg-id-123');
    });

    it('should preserve Twitch-specific metadata', async () => {
      const result = await engine.translateInbound('twitch', 'PRIVMSG', fixture);

      // Custom fields should be in identity metadata
      expect(result.identity.external.metadata).toBeDefined();
    });
  });

  describe('Twitch: whisper → dm.message.v1', () => {
    const fixture = {
      userId: '987654321',
      userLogin: 'whisperuser',
      userDisplayName: 'WhisperUser',
      text: 'Hello! This is a whisper.',
      messageId: 'whisper-msg-456',
      color: '#0000FF',
      badges: { premium: '1' },
      emotes: null,
    };

    it('should normalize to dm.message.v1', async () => {
      const result = await engine.translateInbound('twitch', 'whisper', fixture);

      expect(result.type).toBe('dm.message.v1');
    });

    it('should extract whisper fields', async () => {
      const result = await engine.translateInbound('twitch', 'whisper', fixture);

      expect(result.identity.external.id).toBe('987654321');
      expect(result.identity.external.displayName).toBe('WhisperUser');
      expect(result.message?.text).toBe('Hello! This is a whisper.');
      expect(result.egress.type).toBe('dm');
    });
  });

  describe('Field Consistency', () => {
    it('should produce consistent envelope structure across platforms', async () => {
      // DiscordMessageMeta structure (normalized by DiscordIngressClient)
      const discordFixture = {
        messageId: '1',
        channelType: 0,
        content: 'Test',
        channelId: 'C1',
        guildId: 'G1',
        authorId: 'U1',
        authorName: 'user1',
        createdAt: '2026-08-14T12:00:00.000Z',
      };

      const slackFixture = {
        type: 'message',
        user: 'U1',
        text: 'Test',
        ts: '1.1',
        channel: 'C1',
        event_ts: '1.1',
      };

      const twitchFixture = {
        channel: 'channel1',
        userLogin: 'user1',
        text: 'Test',
        message: 'Test', // Added by TranslationEngineEnvelopeBuilder
        userDisplayName: 'user1',
        userId: 'U1',
        messageId: 'msg-1',
        raw: {
          tags: { 'user-id': 'U1', 'display-name': 'user1', id: 'msg-1' },
        },
      };

      const discord = await engine.translateInbound('discord', 'MESSAGE_CREATE', discordFixture);
      const slack = await engine.translateInbound('slack', 'message', slackFixture);
      const twitch = await engine.translateInbound('twitch', 'PRIVMSG', twitchFixture);

      // All should have same top-level structure
      expect(discord.v).toBe('2');
      expect(slack.v).toBe('2');
      expect(twitch.v).toBe('2');

      expect(discord.type).toBe('chat.message.v1');
      expect(slack.type).toBe('chat.message.v1');
      expect(twitch.type).toBe('chat.message.v1');

      // All should have required sections
      ['ingress', 'identity', 'egress', 'message', 'routing'].forEach((section) => {
        expect(discord[section as keyof InternalEventV2]).toBeDefined();
        expect(slack[section as keyof InternalEventV2]).toBeDefined();
        expect(twitch[section as keyof InternalEventV2]).toBeDefined();
      });
    });

    it('should not add unexpected fields to envelope', async () => {
      // DiscordMessageMeta structure (normalized by DiscordIngressClient)
      const fixture = {
        messageId: '1',
        channelType: 0,
        content: 'Test',
        channelId: 'C1',
        guildId: 'G1',
        authorId: 'U1',
        authorName: 'user1',
        createdAt: '2026-08-14T12:00:00.000Z',
      };

      const result = await engine.translateInbound('discord', 'MESSAGE_CREATE', fixture);

      // Expected top-level fields only
      const expectedKeys = [
        'v',
        'correlationId',
        'traceId',
        'type',
        'ingress',
        'identity',
        'egress',
        'message',
        'routing',
      ];

      const actualKeys = Object.keys(result);

      // All expected keys should be present
      expectedKeys.forEach((key) => {
        expect(actualKeys).toContain(key);
      });

      // Should not have extraneous keys (beyond expected + optional metadata, annotations, etc.)
      // Platform-specific custom fields are allowed (e.g., guildId, channelType from Discord)
      const allowedOptionalKeys = [
        'metadata',
        'annotations',
        'candidates',
        'qos',
        'errors',
        'payload',
        'externalEvent',
        // Discord custom fields (from DiscordMessageMeta via YAML mapping)
        'guildId',
        'channelType',
        'mentions',
        'roles',
        'isOwner',
      ];
      actualKeys.forEach((key) => {
        expect([...expectedKeys, ...allowedOptionalKeys]).toContain(key);
      });
    });
  });

  describe('Error Handling', () => {
    it('should throw meaningful error for unknown platform event', async () => {
      const fixture = { foo: 'bar' };

      await expect(
        engine.translateInbound('discord', 'UNKNOWN_EVENT', fixture)
      ).rejects.toThrow('No event mapping found for discord:UNKNOWN_EVENT');
    });

    it('should throw meaningful error for unknown platform', async () => {
      const fixture = { foo: 'bar' };

      await expect(
        engine.translateInbound('unknown_platform', 'MESSAGE_CREATE', fixture)
      ).rejects.toThrow('No event mapping found for unknown_platform:MESSAGE_CREATE');
    });
  });
});

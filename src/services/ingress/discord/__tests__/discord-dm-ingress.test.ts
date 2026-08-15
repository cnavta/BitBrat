/**
 * Discord DM Ingress Detection Tests
 *
 * Test suite for Discord DM channel type detection and event routing.
 *
 * Sprint 13: DM Capability Implementation (DM-003)
 *
 * @since Sprint 13
 */

import { buildDiscordEnvelope, DiscordMessageMeta } from '../envelope-builder';

describe('Discord DM Ingress Detection', () => {
  describe('buildDiscordEnvelope with channel type detection', () => {
    it('should create dm.message.v1 event for DM channel (channelType = 1)', () => {
      const meta: DiscordMessageMeta = {
        guildId: '', // DMs don't have guilds
        channelId: 'dm-channel-123',
        messageId: 'msg-123',
        authorId: 'user-123',
        authorName: 'john_doe',
        content: 'Hello in DM!',
        channelType: 1, // ChannelType.DM
      };

      const envelope = buildDiscordEnvelope(meta);

      expect(envelope.type).toBe('dm.message.v1');
      expect(envelope.egress.type).toBe('dm');
      expect(envelope.identity.external.id).toBe('user-123');
      expect(envelope.message?.text).toBe('Hello in DM!');
    });

    it('should create chat.message.v1 event for guild text channel (channelType = 0)', () => {
      const meta: DiscordMessageMeta = {
        guildId: 'guild-123',
        channelId: 'channel-456',
        messageId: 'msg-456',
        authorId: 'user-456',
        authorName: 'jane_doe',
        content: 'Hello in channel!',
        channelType: 0, // ChannelType.GUILD_TEXT
      };

      const envelope = buildDiscordEnvelope(meta);

      expect(envelope.type).toBe('chat.message.v1');
      expect(envelope.egress.type).toBe('chat');
      expect(envelope.identity.external.id).toBe('user-456');
      expect(envelope.message?.text).toBe('Hello in channel!');
    });

    it('should default to chat.message.v1 when channelType is undefined', () => {
      const meta: DiscordMessageMeta = {
        guildId: 'guild-789',
        channelId: 'channel-789',
        messageId: 'msg-789',
        authorId: 'user-789',
        authorName: 'old_user',
        content: 'Legacy message without channel type',
        // channelType is undefined
      };

      const envelope = buildDiscordEnvelope(meta);

      expect(envelope.type).toBe('chat.message.v1');
      expect(envelope.egress.type).toBe('chat');
    });

    it('should preserve DM userId in identity.external.id', () => {
      const meta: DiscordMessageMeta = {
        guildId: '',
        channelId: 'dm-channel-999',
        messageId: 'msg-999',
        authorId: 'user-999',
        authorName: 'dm_user',
        content: 'DM with userId',
        channelType: 1,
      };

      const envelope = buildDiscordEnvelope(meta);

      expect(envelope.type).toBe('dm.message.v1');
      expect(envelope.identity.external.id).toBe('user-999');
      expect(envelope.identity.external.platform).toBe('discord');
      expect(envelope.identity.external.displayName).toBe('dm_user');
    });

    it('should set correct egress channel for DM', () => {
      const meta: DiscordMessageMeta = {
        guildId: '',
        channelId: 'dm-channel-777',
        messageId: 'msg-777',
        authorId: 'user-777',
        authorName: 'test_dm',
        content: 'DM egress test',
        channelType: 1,
      };

      const envelope = buildDiscordEnvelope(meta);

      expect(envelope.egress.connector).toBe('discord');
      expect(envelope.egress.channel).toBe('dm-channel-777');
      expect(envelope.egress.type).toBe('dm');
    });

    it('should work with debug metadata for DM messages', () => {
      const meta: DiscordMessageMeta = {
        guildId: '',
        channelId: 'dm-channel-debug',
        messageId: 'msg-debug',
        authorId: 'user-debug',
        authorName: 'debug_user',
        content: 'Debug DM test',
        channelType: 1,
      };

      const debugMetadata = {
        enabled: true as const,
        initiatedBy: 'user-debug',
        feedbackChannel: 'dm-channel-debug',
        startedAt: new Date().toISOString(),
      };

      const envelope = buildDiscordEnvelope(meta, { debugMetadata });

      expect(envelope.type).toBe('dm.message.v1');
      expect(envelope.qos?.tracer).toBe(true);
      expect(envelope.metadata?.debug).toEqual(debugMetadata);
    });

    it('should handle DM with mentions (edge case)', () => {
      const meta: DiscordMessageMeta = {
        guildId: '',
        channelId: 'dm-channel-mentions',
        messageId: 'msg-mentions',
        authorId: 'user-mentions',
        authorName: 'mention_user',
        content: '@someone hello',
        channelType: 1,
        mentions: ['someone-id'],
      };

      const envelope = buildDiscordEnvelope(meta);

      expect(envelope.type).toBe('dm.message.v1');
      expect(envelope.message?.rawPlatformPayload?.mentions).toEqual(['someone-id']);
    });

    it('should not include roles for DM messages (no guild context)', () => {
      const meta: DiscordMessageMeta = {
        guildId: '',
        channelId: 'dm-channel-no-roles',
        messageId: 'msg-no-roles',
        authorId: 'user-no-roles',
        authorName: 'no_roles_user',
        content: 'DM without roles',
        channelType: 1,
        roles: [], // Empty roles array for DMs
      };

      const envelope = buildDiscordEnvelope(meta);

      expect(envelope.type).toBe('dm.message.v1');
      expect(envelope.identity.external.metadata?.roles).toEqual([]);
    });

    it('should handle group DM channel type (channelType = 3)', () => {
      const meta: DiscordMessageMeta = {
        guildId: '',
        channelId: 'group-dm-channel',
        messageId: 'msg-group',
        authorId: 'user-group',
        authorName: 'group_user',
        content: 'Group DM message',
        channelType: 3, // ChannelType.GROUP_DM
      };

      const envelope = buildDiscordEnvelope(meta);

      // Group DMs are treated as chat messages (not 1-to-1 DMs)
      expect(envelope.type).toBe('chat.message.v1');
      expect(envelope.egress.type).toBe('chat');
    });

    it('should preserve correlation ID when provided', () => {
      const meta: DiscordMessageMeta = {
        guildId: '',
        channelId: 'dm-channel-corr',
        messageId: 'msg-corr',
        authorId: 'user-corr',
        authorName: 'corr_user',
        content: 'DM with correlation',
        channelType: 1,
      };

      const correlationId = 'custom-correlation-id-123';
      const envelope = buildDiscordEnvelope(meta, { correlationId });

      expect(envelope.type).toBe('dm.message.v1');
      expect(envelope.correlationId).toBe(correlationId);
    });

    it('should preserve egress destination topic for DMs', () => {
      const meta: DiscordMessageMeta = {
        guildId: '',
        channelId: 'dm-channel-dest',
        messageId: 'msg-dest',
        authorId: 'user-dest',
        authorName: 'dest_user',
        content: 'DM with egress destination',
        channelType: 1,
      };

      const egressDestination = 'internal.egress.v1.instance-abc';
      const envelope = buildDiscordEnvelope(meta, { egressDestination });

      expect(envelope.type).toBe('dm.message.v1');
      expect(envelope.egress.destination).toBe(egressDestination);
    });

    it('should handle empty guildId for DM messages', () => {
      const meta: DiscordMessageMeta = {
        guildId: '', // DMs have empty guildId
        channelId: 'dm-channel-no-guild',
        messageId: 'msg-no-guild',
        authorId: 'user-no-guild',
        authorName: 'no_guild_user',
        content: 'DM without guild',
        channelType: 1,
      };

      const envelope = buildDiscordEnvelope(meta);

      expect(envelope.type).toBe('dm.message.v1');
      expect(envelope.message?.rawPlatformPayload?.guildId).toBe('');
      expect(envelope.identity.external.metadata?.guildId).toBe('');
    });
  });
});

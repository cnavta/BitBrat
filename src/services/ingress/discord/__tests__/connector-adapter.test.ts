/**
 * Discord Connector Adapter Tests
 *
 * Tests for DiscordConnectorAdapter (IngressConnector interface).
 *
 * Sprint 11: Discord Integration Modernization (DISC-012)
 *
 * @since Sprint 11
 */

import { DiscordConnectorAdapter } from '../connector-adapter';
import type { DiscordIngressClient } from '../discord-ingress-client';
import type { ConnectorSnapshot } from '../../core';
import type { IConfig } from '../../../../types';

// Mock logger
jest.mock('../../../../common/logging', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('DiscordConnectorAdapter', () => {
  let mockClient: jest.Mocked<DiscordIngressClient>;
  let adapter: DiscordConnectorAdapter;
  let config: Partial<IConfig>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock DiscordIngressClient
    mockClient = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      getSnapshot: jest.fn().mockReturnValue({
        state: 'CONNECTED',
        platform: 'discord',
        guildId: 'guild123',
        channelIds: ['channel1'],
        counters: { received: 10, published: 8, errors: 0 },
      } as ConnectorSnapshot),
      sendText: jest.fn().mockResolvedValue(undefined),
      banUser: jest.fn().mockResolvedValue(undefined),
    } as any;

    config = {
      discordEnabled: true,
      discordBotToken: 'test_token',
      discordGuildId: 'guild123',
      discordChannels: ['channel1'],
      discordPublicKey: 'test_public_key',
    };

    adapter = new DiscordConnectorAdapter(mockClient, config as IConfig);
  });

  describe('IngressConnector interface', () => {
    describe('start()', () => {
      it('should start Discord Gateway client', async () => {
        await adapter.start();
        expect(mockClient.start).toHaveBeenCalledTimes(1);
      });

      it('should transition state to CONNECTING then CONNECTED', async () => {
        // Mock state transitions
        mockClient.getSnapshot
          .mockReturnValueOnce({ state: 'CONNECTING' } as ConnectorSnapshot)
          .mockReturnValueOnce({ state: 'CONNECTED' } as ConnectorSnapshot);

        await adapter.start();

        const snapshot1 = adapter.getSnapshot();
        expect(snapshot1.state).toBe('CONNECTING');

        // Simulate connection complete
        const snapshot2 = adapter.getSnapshot();
        expect(snapshot2.state).toBe('CONNECTED');
      });

      it('should handle start errors gracefully', async () => {
        const error = new Error('Connection failed');
        mockClient.start.mockRejectedValueOnce(error);

        await expect(adapter.start()).rejects.toThrow('Connection failed');
      });

      it('should be idempotent (safe to call multiple times)', async () => {
        await adapter.start();
        await adapter.start();
        await adapter.start();

        // Client.start() should be called each time (client handles idempotency)
        expect(mockClient.start).toHaveBeenCalledTimes(3);
      });
    });

    describe('stop()', () => {
      it('should stop Discord Gateway client', async () => {
        await adapter.stop();
        expect(mockClient.stop).toHaveBeenCalledTimes(1);
      });

      it('should transition state to DISCONNECTED', async () => {
        mockClient.getSnapshot.mockReturnValue({ state: 'DISCONNECTED' } as ConnectorSnapshot);

        await adapter.stop();

        const snapshot = adapter.getSnapshot();
        expect(snapshot.state).toBe('DISCONNECTED');
      });

      it('should clean up resources (intervals, listeners)', async () => {
        await adapter.stop();
        // Cleanup is handled by client.stop()
        expect(mockClient.stop).toHaveBeenCalled();
      });

      it('should be idempotent (safe to call multiple times)', async () => {
        await adapter.stop();
        await adapter.stop();
        await adapter.stop();

        expect(mockClient.stop).toHaveBeenCalledTimes(3);
      });
    });

    describe('getSnapshot()', () => {
      it('should return current connector state', () => {
        const snapshot = adapter.getSnapshot();
        expect(snapshot).toBeDefined();
        expect(snapshot.state).toBe('CONNECTED');
      });

      it('should include platform metadata (discord)', () => {
        const snapshot = adapter.getSnapshot();
        expect(snapshot.platform).toBe('discord');
      });

      it('should include connection status (CONNECTED, DISCONNECTED, etc.)', () => {
        const snapshot = adapter.getSnapshot();
        expect(snapshot.state).toBe('CONNECTED');

        // Test different states
        mockClient.getSnapshot.mockReturnValue({ state: 'DISCONNECTED' } as ConnectorSnapshot);
        const snapshot2 = adapter.getSnapshot();
        expect(snapshot2.state).toBe('DISCONNECTED');
      });

      it('should include counters (received, published, errors)', () => {
        const snapshot = adapter.getSnapshot();
        expect(snapshot.counters).toBeDefined();
        expect(snapshot.counters!.received).toBe(10);
        expect(snapshot.counters!.published).toBe(8);
        expect(snapshot.counters!.errors).toBe(0);
      });
    });

    describe('sendText()', () => {
      it('should send text message to Discord channel', async () => {
        await adapter.sendText('Hello Discord', 'channel123');
        expect(mockClient.sendText).toHaveBeenCalledWith('Hello Discord', 'channel123');
      });

      it('should require target channel ID parameter', async () => {
        await expect(adapter.sendText('Hello')).rejects.toThrow('discord_connector_adapter.target_required');
        expect(mockClient.sendText).not.toHaveBeenCalled();
      });

      it('should throw error when target is missing', async () => {
        await expect(adapter.sendText('Hello', undefined)).rejects.toThrow('discord_connector_adapter.target_required');
      });

      it('should throw error when client is not connected', async () => {
        const error = new Error('Client not connected');
        mockClient.sendText.mockRejectedValueOnce(error);

        await expect(adapter.sendText('Hello', 'channel123')).rejects.toThrow('Client not connected');
      });

      it('should log successful send', async () => {
        const { logger } = require('../../../../common/logging');
        await adapter.sendText('Hello', 'channel123');

        expect(logger.info).toHaveBeenCalledWith('discord.adapter.text_sent', { target: 'channel123' });
      });

      it('should log failed send', async () => {
        const { logger } = require('../../../../common/logging');
        const error = new Error('Send failed');
        mockClient.sendText.mockRejectedValueOnce(error);

        await expect(adapter.sendText('Hello', 'channel123')).rejects.toThrow('Send failed');
        expect(logger.error).toHaveBeenCalledWith('discord.adapter.send_failed', {
          error: 'Send failed',
          target: 'channel123',
        });
      });
    });
  });

  describe('EgressConnector interface', () => {
    describe('banUser()', () => {
      it('should ban user from Discord guild', async () => {
        await adapter.banUser('user123');
        expect(mockClient.banUser).toHaveBeenCalledWith('user123', undefined);
      });

      it('should accept optional reason parameter', async () => {
        await adapter.banUser('user123', 'Spamming');
        expect(mockClient.banUser).toHaveBeenCalledWith('user123', 'Spamming');
      });

      it('should require proper permissions', async () => {
        const error = new Error('Missing permissions: BAN_MEMBERS');
        mockClient.banUser.mockRejectedValueOnce(error);

        await expect(adapter.banUser('user123')).rejects.toThrow('Missing permissions: BAN_MEMBERS');
      });

      it('should handle ban errors gracefully', async () => {
        const error = new Error('Ban failed');
        mockClient.banUser.mockRejectedValueOnce(error);

        await expect(adapter.banUser('user123')).rejects.toThrow('Ban failed');

        const { logger } = require('../../../../common/logging');
        expect(logger.error).toHaveBeenCalledWith('discord.adapter.ban_failed', {
          error: 'Ban failed',
          platformUserId: 'user123',
        });
      });
    });

    describe('timeoutUser()', () => {
      it.todo('should timeout user in Discord guild');
      it.todo('should accept duration parameter');
      it.todo('should require proper permissions');
    });

    describe('deleteMessage()', () => {
      it.todo('should delete message from Discord channel');
      it.todo('should require message ID and channel ID');
      it.todo('should handle delete errors gracefully');
    });
  });

  describe('getMetadata()', () => {
    describe('platform metadata', () => {
      it('should return platform as "discord"', () => {
        const metadata = adapter.getMetadata();
        expect(metadata.platform).toBe('discord');
      });

      it('should return version as "1.0.0"', () => {
        const metadata = adapter.getMetadata();
        expect(metadata.version).toBe('1.0.0');
      });

      it('should return authMethod as "bot_token"', () => {
        const metadata = adapter.getMetadata();
        expect(metadata.authMethod).toBe('bot_token');
      });
    });

    describe('ingress capabilities', () => {
      it('should return method as "hybrid" (Gateway + Interactions)', () => {
        const metadata = adapter.getMetadata();
        expect(metadata.capabilities.ingress.method).toBe('hybrid');
      });

      it('should indicate realtime: true', () => {
        const metadata = adapter.getMetadata();
        expect(metadata.capabilities.ingress.realtime).toBe(true);
      });

      it('should indicate requiresWebhook: false', () => {
        const metadata = adapter.getMetadata();
        expect(metadata.capabilities.ingress.requiresWebhook).toBe(false);
      });

      it('should indicate requiresPublicUrl: false', () => {
        const metadata = adapter.getMetadata();
        expect(metadata.capabilities.ingress.requiresPublicUrl).toBe(false);
      });
    });

    describe('egress capabilities', () => {
      it('should indicate chat: true', () => {
        const metadata = adapter.getMetadata();
        expect(metadata.capabilities.egress.chat).toBe(true);
      });

      it('should indicate dm: true', () => {
        const metadata = adapter.getMetadata();
        expect(metadata.capabilities.egress.dm).toBe(true);
      });

      it('should indicate reactions: true', () => {
        const metadata = adapter.getMetadata();
        expect(metadata.capabilities.egress.reactions).toBe(true);
      });

      it('should indicate threads: true', () => {
        const metadata = adapter.getMetadata();
        expect(metadata.capabilities.egress.threads).toBe(true);
      });
    });

    describe('moderation capabilities', () => {
      it('should indicate ban: true', () => {
        const metadata = adapter.getMetadata();
        expect(metadata.capabilities.moderation.ban).toBe(true);
      });

      it('should indicate timeout: true', () => {
        const metadata = adapter.getMetadata();
        expect(metadata.capabilities.moderation.timeout).toBe(true);
      });

      it('should indicate delete: true', () => {
        const metadata = adapter.getMetadata();
        expect(metadata.capabilities.moderation.delete).toBe(true);
      });
    });
  });

  describe('delegation to DiscordIngressClient', () => {
    it('should delegate start() to client.start()', async () => {
      await adapter.start();
      expect(mockClient.start).toHaveBeenCalledTimes(1);
    });

    it('should delegate stop() to client.stop()', async () => {
      await adapter.stop();
      expect(mockClient.stop).toHaveBeenCalledTimes(1);
    });

    it('should delegate getSnapshot() to client.getSnapshot()', () => {
      adapter.getSnapshot();
      expect(mockClient.getSnapshot).toHaveBeenCalledTimes(1);
    });

    it('should delegate sendText() to client.sendText()', async () => {
      await adapter.sendText('Hello', 'channel123');
      expect(mockClient.sendText).toHaveBeenCalledWith('Hello', 'channel123');
    });

    it('should pass through errors from client methods', async () => {
      const error = new Error('Client error');
      mockClient.start.mockRejectedValueOnce(error);

      await expect(adapter.start()).rejects.toThrow('Client error');
    });
  });

  describe('error handling', () => {
    it('should handle client initialization errors', async () => {
      const error = new Error('Initialization failed');
      mockClient.start.mockRejectedValueOnce(error);

      await expect(adapter.start()).rejects.toThrow('Initialization failed');
    });

    it('should handle client method call errors', async () => {
      const error = new Error('Method call failed');
      mockClient.sendText.mockRejectedValueOnce(error);

      await expect(adapter.sendText('Hello', 'channel123')).rejects.toThrow('Method call failed');
    });

    it('should log errors appropriately', async () => {
      const { logger } = require('../../../../common/logging');
      const error = new Error('Test error');
      mockClient.sendText.mockRejectedValueOnce(error);

      await expect(adapter.sendText('Hello', 'channel123')).rejects.toThrow('Test error');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should not crash on malformed responses', () => {
      // Test with undefined/null client responses
      mockClient.getSnapshot.mockReturnValue(null as any);
      const snapshot = adapter.getSnapshot();
      expect(snapshot).toBeNull();
    });
  });

  describe('backward compatibility', () => {
    it('should work with existing DiscordIngressClient interface', async () => {
      // Ensure adapter works with existing client methods
      await adapter.start();
      await adapter.sendText('Test', 'channel123');
      adapter.getSnapshot();
      await adapter.stop();

      expect(mockClient.start).toHaveBeenCalled();
      expect(mockClient.sendText).toHaveBeenCalled();
      expect(mockClient.getSnapshot).toHaveBeenCalled();
      expect(mockClient.stop).toHaveBeenCalled();
    });

    it('should maintain same public API surface', () => {
      // Verify adapter implements IngressConnector interface
      expect(typeof adapter.start).toBe('function');
      expect(typeof adapter.stop).toBe('function');
      expect(typeof adapter.getSnapshot).toBe('function');
      expect(typeof adapter.sendText).toBe('function');
      expect(typeof adapter.getMetadata).toBe('function');
    });

    it('should not break existing integrations', async () => {
      // Test that adapter can be used as drop-in replacement
      const metadata = adapter.getMetadata();
      expect(metadata.platform).toBe('discord');

      await adapter.start();
      const snapshot = adapter.getSnapshot();
      expect(snapshot).toBeDefined();
      await adapter.stop();
    });
  });
});

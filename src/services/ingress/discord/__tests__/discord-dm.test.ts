/**
 * Discord DM Tests
 *
 * Test suite for Discord direct messaging functionality.
 *
 * Sprint 13: DM Capability Implementation (DM-002)
 *
 * @since Sprint 13
 */

import { DiscordIngressClient } from '../discord-ingress-client';
import { buildDiscordEnvelope } from '../envelope-builder';

describe('Discord DM Functionality', () => {
  let client: DiscordIngressClient;
  let mockDiscordClient: any;
  let mockPublisher: any;
  let mockConfig: any;

  beforeEach(() => {
    // Mock Discord.js client
    mockDiscordClient = {
      isReady: jest.fn().mockReturnValue(true),
      users: {
        fetch: jest.fn(),
      },
      on: jest.fn(),
      login: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn().mockResolvedValue(undefined),
    };

    mockPublisher = {
      publish: jest.fn().mockResolvedValue(undefined),
    };

    mockConfig = {
      discordBotToken: 'test-token',
      discordGuildId: 'test-guild',
      discordChannels: ['test-channel'],
    };

    client = new DiscordIngressClient(buildDiscordEnvelope, mockPublisher, mockConfig);

    // Inject mock Discord client
    (client as any).client = mockDiscordClient;
    (client as any).snapshot.state = 'CONNECTED';
  });

  describe('sendDM', () => {
    it('should send DM successfully to valid user', async () => {
      const mockUser = {
        id: '123456789012345678',
        username: 'testuser',
        createDM: jest.fn().mockResolvedValue({
          id: 'dm-channel-123',
          send: jest.fn().mockResolvedValue({}),
        }),
      };

      mockDiscordClient.users.fetch.mockResolvedValue(mockUser);

      await client.sendDM('Hello from BitBrat!', '123456789012345678');

      expect(mockDiscordClient.users.fetch).toHaveBeenCalledWith('123456789012345678');
      expect(mockUser.createDM).toHaveBeenCalled();
    });

    it('should throw error if client not connected', async () => {
      (client as any).snapshot.state = 'DISCONNECTED';

      await expect(client.sendDM('Hello!', '123456789012345678')).rejects.toThrow(
        'discord_client_not_connected'
      );

      expect(mockDiscordClient.users.fetch).not.toHaveBeenCalled();
    });

    it('should throw error if userId is invalid', async () => {
      await expect(client.sendDM('Hello!', '')).rejects.toThrow('discord_invalid_user_id');

      expect(mockDiscordClient.users.fetch).not.toHaveBeenCalled();
    });

    it('should throw error if user not found', async () => {
      mockDiscordClient.users.fetch.mockResolvedValue(null);

      await expect(client.sendDM('Hello!', '999999999999999999')).rejects.toThrow(
        'discord_user_not_found'
      );
    });

    it('should handle Discord error: user DMs disabled (50007)', async () => {
      const mockUser = {
        id: '123456789012345678',
        username: 'testuser',
        createDM: jest.fn().mockResolvedValue({
          send: jest.fn().mockRejectedValue({ code: 50007, message: 'Cannot send messages to this user' }),
        }),
      };

      mockDiscordClient.users.fetch.mockResolvedValue(mockUser);

      await expect(client.sendDM('Hello!', '123456789012345678')).rejects.toThrow(
        'discord_user_dms_disabled'
      );
    });

    it('should handle Discord error: unknown user (10013)', async () => {
      const error = new Error('Unknown User');
      (error as any).code = 10013;

      mockDiscordClient.users.fetch.mockRejectedValue(error);

      await expect(client.sendDM('Hello!', '999999999999999999')).rejects.toThrow(
        'discord_user_not_found'
      );
    });

    it('should handle Discord error: missing access (50001)', async () => {
      const mockUser = {
        id: '123456789012345678',
        username: 'testuser',
        createDM: jest.fn().mockResolvedValue({
          send: jest.fn().mockRejectedValue({ code: 50001, message: 'Missing Access' }),
        }),
      };

      mockDiscordClient.users.fetch.mockResolvedValue(mockUser);

      await expect(client.sendDM('Hello!', '123456789012345678')).rejects.toThrow(
        'discord_missing_access'
      );
    });

    it('should create DM channel and send message', async () => {
      const mockDMChannel = {
        id: 'dm-channel-123',
        send: jest.fn().mockResolvedValue({}),
      };

      const mockUser = {
        id: '123456789012345678',
        username: 'testuser',
        createDM: jest.fn().mockResolvedValue(mockDMChannel),
      };

      mockDiscordClient.users.fetch.mockResolvedValue(mockUser);

      await client.sendDM('Test message', '123456789012345678');

      expect(mockUser.createDM).toHaveBeenCalled();
      expect(mockDMChannel.send).toHaveBeenCalledWith('Test message');
    });

    it('should handle DM channel creation failure', async () => {
      const mockUser = {
        id: '123456789012345678',
        username: 'testuser',
        createDM: jest.fn().mockResolvedValue(null), // Failed to create channel
      };

      mockDiscordClient.users.fetch.mockResolvedValue(mockUser);

      await expect(client.sendDM('Hello!', '123456789012345678')).rejects.toThrow(
        'discord_dm_channel_creation_failed'
      );
    });

    it('should handle generic errors', async () => {
      const genericError = new Error('Network error');

      mockDiscordClient.users.fetch.mockRejectedValue(genericError);

      await expect(client.sendDM('Hello!', '123456789012345678')).rejects.toThrow('Network error');
    });

    it('should send long messages successfully', async () => {
      const longMessage = 'A'.repeat(2000); // Discord max is 2000 chars

      const mockDMChannel = {
        id: 'dm-channel-123',
        send: jest.fn().mockResolvedValue({}),
      };

      const mockUser = {
        id: '123456789012345678',
        username: 'testuser',
        createDM: jest.fn().mockResolvedValue(mockDMChannel),
      };

      mockDiscordClient.users.fetch.mockResolvedValue(mockUser);

      await client.sendDM(longMessage, '123456789012345678');

      expect(mockDMChannel.send).toHaveBeenCalledWith(longMessage);
    });

    it('should handle multiple DM sends to same user', async () => {
      const mockDMChannel = {
        id: 'dm-channel-123',
        send: jest.fn().mockResolvedValue({}),
      };

      const mockUser = {
        id: '123456789012345678',
        username: 'testuser',
        createDM: jest.fn().mockResolvedValue(mockDMChannel),
      };

      mockDiscordClient.users.fetch.mockResolvedValue(mockUser);

      await client.sendDM('Message 1', '123456789012345678');
      await client.sendDM('Message 2', '123456789012345678');
      await client.sendDM('Message 3', '123456789012345678');

      expect(mockDMChannel.send).toHaveBeenCalledTimes(3);
      expect(mockDMChannel.send).toHaveBeenNthCalledWith(1, 'Message 1');
      expect(mockDMChannel.send).toHaveBeenNthCalledWith(2, 'Message 2');
      expect(mockDMChannel.send).toHaveBeenNthCalledWith(3, 'Message 3');
    });
  });
});

import { TwitchConnectorAdapter } from './connector-adapter';
import type { ITwitchIrcClient } from './twitch-irc-client';

describe('Twitch Whisper (DM) Integration (DM-009)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('DM Egress: Send whisper via sendDM()', () => {
    it('should send whisper using sendWhisper method', async () => {
      // Create mock Twitch IRC client
      const mockSendWhisper = jest.fn(async (text: string, userId: string) => {});

      const mockClient: Partial<ITwitchIrcClient> = {
        start: jest.fn(async () => {}),
        stop: jest.fn(async () => {}),
        sendText: jest.fn(async () => {}),
        sendWhisper: mockSendWhisper,
        getSnapshot: jest.fn(() => ({
          state: 'CONNECTED',
          userId: 'twitch-bot-123',
          displayName: 'TestBot',
          joinedChannels: ['testchannel'],
          reconnects: 0,
          lastMessageAt: new Date().toISOString(),
        })),
      };

      const adapter = new TwitchConnectorAdapter(mockClient as ITwitchIrcClient);

      // Send DM via adapter
      await adapter.sendDM('Hello, this is a whisper!', 'user-456');

      // Verify sendWhisper was called
      expect(mockSendWhisper).toHaveBeenCalledWith('Hello, this is a whisper!', 'user-456');
    });

    it('should use sendDM as alias for sendWhisper', async () => {
      const mockSendWhisper = jest.fn(async (text: string, userId: string) => {});

      const mockClient: Partial<ITwitchIrcClient> = {
        start: jest.fn(async () => {}),
        stop: jest.fn(async () => {}),
        sendWhisper: mockSendWhisper,
        getSnapshot: jest.fn(() => ({
          state: 'CONNECTED',
          userId: 'twitch-bot-123',
          displayName: 'TestBot',
          joinedChannels: [],
          reconnects: 0,
          lastMessageAt: new Date().toISOString(),
        })),
      };

      const adapter = new TwitchConnectorAdapter(mockClient as ITwitchIrcClient);

      // Call sendDM (which should delegate to sendWhisper)
      await adapter.sendDM('Test message', 'recipient-789');

      // Verify delegation occurred
      expect(mockSendWhisper).toHaveBeenCalledWith('Test message', 'recipient-789');
      expect(mockSendWhisper).toHaveBeenCalledTimes(1);
    });

    it('should handle missing sendWhisper method gracefully', async () => {
      // Mock client without sendWhisper method
      const mockClient: Partial<ITwitchIrcClient> = {
        start: jest.fn(async () => {}),
        stop: jest.fn(async () => {}),
        getSnapshot: jest.fn(() => ({
          state: 'CONNECTED',
          userId: 'twitch-bot-123',
          displayName: 'TestBot',
          joinedChannels: [],
          reconnects: 0,
          lastMessageAt: new Date().toISOString(),
        })),
      };

      const adapter = new TwitchConnectorAdapter(mockClient as ITwitchIrcClient);

      // Should not throw error when sendWhisper is missing
      await expect(adapter.sendDM('Test', 'user-123')).resolves.not.toThrow();
    });
  });

  describe('Connector Metadata', () => {
    it('should report DM capability in metadata', () => {
      const mockClient: Partial<ITwitchIrcClient> = {
        getSnapshot: jest.fn(() => ({
          state: 'CONNECTED',
          userId: 'twitch-bot',
          displayName: 'Bot',
          joinedChannels: [],
          reconnects: 0,
          lastMessageAt: new Date().toISOString(),
        })),
      };

      const adapter = new TwitchConnectorAdapter(mockClient as ITwitchIrcClient);
      const metadata = adapter.getMetadata();

      expect(metadata.platform).toBe('twitch');
      expect(metadata.capabilities.egress.dm).toBe(true);
    });
  });

  describe('Whisper event normalization (YAML-based)', () => {
    it('should have YAML config for whisper event mapping', () => {
      // This test verifies that the YAML config exists and is valid
      // The actual validation is done by yaml-schema-validation.test.ts
      const fs = require('fs');
      const path = require('path');

      const configPath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'twitch',
        'dm-message.v1.yaml'
      );

      // Verify file exists
      expect(fs.existsSync(configPath)).toBe(true);

      // Read and parse YAML
      const yaml = require('yaml');
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = yaml.parse(content);

      // Verify key properties
      expect(config.platformEvent).toBe('whisper');
      expect(config.internalEventType).toBe('dm.message.v1');
      expect(config.priority).toBe(10);
      expect(config.fieldMapping).toBeDefined();
      expect(config.fieldMapping.userId).toBeDefined();
      expect(config.fieldMapping.messageText).toBeDefined();
      expect(config.fieldMapping.channelId).toBeDefined(); // Uses userId as pseudo-channel
    });
  });
});

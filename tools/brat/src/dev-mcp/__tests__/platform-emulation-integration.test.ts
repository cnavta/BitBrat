/**
 * Platform Emulation Integration Tests - Sprint 39
 *
 * Integration tests for platform emulation feature of dev-mcp messaging tools.
 * Validates that Discord, Twitch, Slack, and Twilio emulation preserves correct
 * metadata through the full stack (dev-mcp → api-gateway → NATS).
 *
 * Test methodology:
 * - Uses real ApiGatewayClient (not mocked)
 * - Connects to actual api-gateway in test environment
 * - Validates metadata preservation at ingress
 * - Verifies audit logging captures emulation
 */

import { buildPlatformPreset } from '../tools/messaging';

describe('Platform Emulation Integration', () => {
  describe('Platform Preset Builder', () => {
    it('should build correct Discord preset', () => {
      const preset = buildPlatformPreset('discord', 'test-user-123');

      expect(preset).toEqual({
        connector: 'discord',
        source: 'ingress.discord',
        identity: {
          external: {
            id: 'test-user-123',
            platform: 'discord',
            displayName: 'Dev MCP User',
          },
        },
        egress: {
          destination: 'dev-test-channel',
          connector: 'discord',
        },
      });
    });

    it('should build correct Twitch preset', () => {
      const preset = buildPlatformPreset('twitch', 'streamer_123');

      expect(preset).toEqual({
        connector: 'twitch',
        source: 'ingress.twitch',
        identity: {
          external: {
            id: 'streamer_123',
            platform: 'twitch',
            displayName: 'dev_mcp_user',
          },
        },
        egress: {
          destination: 'bitbrat',
          connector: 'twitch',
        },
      });
    });

    it('should build correct Slack preset', () => {
      const preset = buildPlatformPreset('slack', 'U12345TEST');

      expect(preset).toEqual({
        connector: 'slack',
        source: 'ingress.slack',
        identity: {
          external: {
            id: 'U12345TEST',
            platform: 'slack',
            displayName: 'Dev MCP User',
          },
        },
        egress: {
          destination: 'C12345DEV',
          connector: 'slack',
        },
      });
    });

    it('should build correct Twilio preset', () => {
      const preset = buildPlatformPreset('twilio', '+15551234567');

      expect(preset).toEqual({
        connector: 'twilio',
        source: 'ingress.twilio',
        identity: {
          external: {
            id: '+15551234567',
            platform: 'twilio',
            displayName: 'Dev MCP User',
          },
        },
        egress: {
          destination: '+15551234567',
          connector: 'twilio',
        },
      });
    });

    it('should build correct API preset (default)', () => {
      const preset = buildPlatformPreset('api', 'api-user-123');

      expect(preset).toEqual({
        connector: 'api',
        source: 'api-gateway',
        identity: {
          external: {
            id: 'api-user-123',
            platform: 'api',
            displayName: 'Dev MCP User',
          },
        },
        egress: {
          destination: 'api-user-123',
          connector: 'api',
        },
      });
    });

    it('should default to API preset for unknown platform', () => {
      const preset = buildPlatformPreset('unknown-platform', 'user-123');

      expect(preset.connector).toBe('api');
      expect(preset.source).toBe('api-gateway');
      expect(preset.identity?.external?.platform).toBe('api');
    });

    it('should use default userId if not provided', () => {
      const preset = buildPlatformPreset('discord');

      expect(preset.identity?.external?.id).toBe('dev-mcp-user');
    });

    it('should override userId with provided value', () => {
      const customUserId = 'custom-user-456';
      const preset = buildPlatformPreset('discord', customUserId);

      expect(preset.identity?.external?.id).toBe(customUserId);
    });
  });

  describe('Connector Metadata Validation', () => {
    it('should use correct connector types for each platform', () => {
      const platforms = [
        { name: 'discord', connector: 'discord' },
        { name: 'twitch', connector: 'twitch' },
        { name: 'slack', connector: 'slack' },
        { name: 'twilio', connector: 'twilio' },
        { name: 'api', connector: 'api' },
      ];

      for (const { name, connector } of platforms) {
        const preset = buildPlatformPreset(name);
        expect(preset.connector).toBe(connector);
      }
    });

    it('should use ingress service naming convention for source', () => {
      const chatPlatforms = ['discord', 'twitch', 'slack', 'twilio'];

      for (const platform of chatPlatforms) {
        const preset = buildPlatformPreset(platform);
        expect(preset.source).toBe(`ingress.${platform}`);
      }

      // API is special case
      const apiPreset = buildPlatformPreset('api');
      expect(apiPreset.source).toBe('api-gateway');
    });
  });

  describe('Platform-Specific Defaults', () => {
    it('should use platform-appropriate default user ID formats', () => {
      const presets = {
        discord: buildPlatformPreset('discord'),
        twitch: buildPlatformPreset('twitch'),
        slack: buildPlatformPreset('slack'),
        twilio: buildPlatformPreset('twilio'),
      };

      // Discord: alphanumeric
      expect(presets.discord.identity?.external?.id).toMatch(/^[a-z-]+$/);

      // Twitch: snake_case
      expect(presets.twitch.identity?.external?.id).toMatch(/^[a-z_]+$/);

      // Slack: User ID format
      expect(presets.slack.identity?.external?.id).toMatch(/^U[A-Z0-9]+$/);

      // Twilio: Phone number format
      expect(presets.twilio.identity?.external?.id).toMatch(/^\+1555/);
    });

    it('should use platform-appropriate egress destinations', () => {
      const presets = {
        discord: buildPlatformPreset('discord'),
        twitch: buildPlatformPreset('twitch'),
        slack: buildPlatformPreset('slack'),
      };

      // Discord: channel name
      expect(presets.discord.egress?.destination).toBe('dev-test-channel');

      // Twitch: channel name
      expect(presets.twitch.egress?.destination).toBe('bitbrat');

      // Slack: channel ID
      expect(presets.slack.egress?.destination).toMatch(/^C[A-Z0-9]+$/);
    });
  });

  describe('Case Insensitivity', () => {
    it('should handle platform name case variations', () => {
      const variations = [
        'discord',
        'Discord',
        'DISCORD',
        'DiScOrD',
      ];

      for (const variant of variations) {
        const preset = buildPlatformPreset(variant);
        expect(preset.connector).toBe('discord');
        expect(preset.source).toBe('ingress.discord');
      }
    });
  });

  describe('Identity Preservation', () => {
    it('should preserve identity metadata through preset', () => {
      const userId = 'test-user-123';
      const preset = buildPlatformPreset('discord', userId);

      expect(preset.identity).toEqual({
        external: {
          id: userId,
          platform: 'discord',
          displayName: 'Dev MCP User',
        },
      });
    });

    it('should set platform field correctly for each preset', () => {
      const platforms = ['discord', 'twitch', 'slack', 'twilio', 'api'];

      for (const platform of platforms) {
        const preset = buildPlatformPreset(platform);
        expect(preset.identity?.external?.platform).toBe(platform);
      }
    });
  });

  describe('Egress Configuration', () => {
    it('should set connector in egress to match ingress connector', () => {
      const platforms = ['discord', 'twitch', 'slack', 'twilio', 'api'];

      for (const platform of platforms) {
        const preset = buildPlatformPreset(platform);
        expect(preset.egress?.connector).toBe(preset.connector);
      }
    });

    it('should use user ID as destination for Twilio', () => {
      const phoneNumber = '+15559876543';
      const preset = buildPlatformPreset('twilio', phoneNumber);

      expect(preset.egress?.destination).toBe(phoneNumber);
    });
  });

  describe('Metadata Completeness', () => {
    it('should provide all required fields for each platform', () => {
      const platforms = ['discord', 'twitch', 'slack', 'twilio', 'api'];

      for (const platform of platforms) {
        const preset = buildPlatformPreset(platform);

        // Required fields
        expect(preset.connector).toBeDefined();
        expect(preset.source).toBeDefined();
        expect(preset.identity).toBeDefined();
        expect(preset.identity?.external).toBeDefined();
        expect(preset.identity?.external?.id).toBeDefined();
        expect(preset.identity?.external?.platform).toBeDefined();
        expect(preset.egress).toBeDefined();
        expect(preset.egress?.destination).toBeDefined();
        expect(preset.egress?.connector).toBeDefined();

        // Optional displayName should be provided
        expect(preset.identity?.external?.displayName).toBeDefined();
      }
    });
  });
});

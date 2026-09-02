/**
 * Unit tests for messaging tools
 *
 * Sprint 39: Dev MCP Messaging Tools
 * Task 2.8: Comprehensive unit tests for messaging tools and helpers
 *
 * Test Coverage:
 * - Platform preset generation (7 tests)
 * - Token acquisition logic (5 tests)
 * - message.send tool (5 tests)
 * - event.send tool (5 tests)
 */

import {
  buildPlatformPreset,
  acquireAuthToken,
  messageSendTool,
  eventSendTool,
} from '../../tools/messaging';

describe('Messaging Tools', () => {
  describe('buildPlatformPreset', () => {
    it('should generate Discord preset with defaults', () => {
      const preset = buildPlatformPreset('discord');

      expect(preset.connector).toBe('discord');
      expect(preset.source).toBe('ingress.discord');
      expect(preset.identity?.external?.id).toBe('dev-mcp-user');
      expect(preset.identity?.external?.platform).toBe('discord');
      expect(preset.egress?.connector).toBe('discord');
      expect(preset.egress?.destination).toBe('dev-test-channel');
    });

    it('should generate Discord preset with custom userId', () => {
      const preset = buildPlatformPreset('discord', 'custom-user-123');

      expect(preset.identity?.external?.id).toBe('custom-user-123');
      expect(preset.identity?.external?.platform).toBe('discord');
    });

    it('should generate Twitch preset', () => {
      const preset = buildPlatformPreset('twitch');

      expect(preset.connector).toBe('twitch');
      expect(preset.source).toBe('ingress.twitch');
      expect(preset.identity?.external?.id).toBe('dev_mcp_user');
      expect(preset.identity?.external?.platform).toBe('twitch');
      expect(preset.egress?.destination).toBe('bitbrat');
    });

    it('should generate Slack preset', () => {
      const preset = buildPlatformPreset('slack');

      expect(preset.connector).toBe('slack');
      expect(preset.source).toBe('ingress.slack');
      expect(preset.identity?.external?.id).toBe('U12345DEV');
      expect(preset.identity?.external?.platform).toBe('slack');
    });

    it('should generate Twilio preset', () => {
      const preset = buildPlatformPreset('twilio');

      expect(preset.connector).toBe('twilio');
      expect(preset.source).toBe('ingress.twilio');
      expect(preset.identity?.external?.id).toBe('+15555551234');
      expect(preset.identity?.external?.platform).toBe('twilio');
    });

    it('should generate API preset (default)', () => {
      const preset = buildPlatformPreset('api');

      expect(preset.connector).toBe('api');
      expect(preset.source).toBe('api-gateway');
      expect(preset.identity?.external?.id).toBe('brat-dev-mcp:chat');
      expect(preset.identity?.external?.platform).toBe('api');
    });

    it('should default to API preset for unknown platform', () => {
      const preset = buildPlatformPreset('unknown-platform');

      expect(preset.connector).toBe('api');
      expect(preset.source).toBe('api-gateway');
    });
  });

  describe('acquireAuthToken', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      // Reset environment before each test
      process.env = { ...originalEnv };
      delete process.env.DEV_MCP_AUTH_TOKEN;
      delete process.env.BITBRAT_AUTH_TOKEN;
    });

    afterAll(() => {
      // Restore original environment
      process.env = originalEnv;
    });

    it('should return cached token if available', async () => {
      const connection = {
        gateway: {
          authToken: 'cached-token-123',
        },
      };

      const token = await acquireAuthToken(connection, 'test-context');

      expect(token).toBe('cached-token-123');
    });

    it('should use DEV_MCP_AUTH_TOKEN environment variable', async () => {
      process.env.DEV_MCP_AUTH_TOKEN = 'env-dev-token';

      const connection: any = {};
      const token = await acquireAuthToken(connection, 'test-context');

      expect(token).toBe('env-dev-token');
      expect(connection.gateway?.authToken).toBe('env-dev-token');
    });

    it('should use BITBRAT_AUTH_TOKEN environment variable', async () => {
      process.env.BITBRAT_AUTH_TOKEN = 'env-bitbrat-token';

      const connection: any = {};
      const token = await acquireAuthToken(connection, 'test-context');

      expect(token).toBe('env-bitbrat-token');
      expect(connection.gateway?.authToken).toBe('env-bitbrat-token');
    });

    it('should generate token for agent-dev contexts', async () => {
      const connection: any = {};
      const token = await acquireAuthToken(connection, 'agent-dev-test-123');

      expect(token).toMatch(/^dev-mcp-[0-9a-f]{64}$/);
      expect(connection.gateway?.authToken).toBe(token);
    });

    it('should throw error for production contexts without token', async () => {
      const connection: any = {};

      await expect(
        acquireAuthToken(connection, 'production')
      ).rejects.toThrow(/Authentication token required/);
    });

    it('should prefer DEV_MCP_AUTH_TOKEN over BITBRAT_AUTH_TOKEN', async () => {
      process.env.DEV_MCP_AUTH_TOKEN = 'dev-token';
      process.env.BITBRAT_AUTH_TOKEN = 'bitbrat-token';

      const connection: any = {};
      const token = await acquireAuthToken(connection, 'test-context');

      expect(token).toBe('dev-token');
    });
  });

  describe('message.send tool', () => {
    it('should have correct tool definition', () => {
      expect(messageSendTool.name).toBe('message.send');
      expect(messageSendTool.description).toContain('chat message');
      expect(messageSendTool.inputSchema).toBeDefined();
    });

    it('should validate schema with required fields', () => {
      const validArgs = {
        context: 'local',
        text: 'Hello, world!',
      };

      const result = messageSendTool.inputSchema.safeParse(validArgs);
      expect(result.success).toBe(true);
    });

    it('should validate schema with optional fields', () => {
      const validArgs = {
        context: 'agent-dev-test',
        text: 'Test message',
        platform: 'discord',
        userId: 'user-123',
        waitForResponse: true,
        timeoutMs: 10000,
      };

      const result = messageSendTool.inputSchema.safeParse(validArgs);
      expect(result.success).toBe(true);
    });

    it('should reject invalid platform', () => {
      const invalidArgs = {
        context: 'local',
        text: 'Test',
        platform: 'invalid-platform',
      };

      const result = messageSendTool.inputSchema.safeParse(invalidArgs);
      expect(result.success).toBe(false);
    });

    it('should reject missing required fields', () => {
      const invalidArgs = {
        context: 'local',
        // Missing text
      };

      const result = messageSendTool.inputSchema.safeParse(invalidArgs);
      expect(result.success).toBe(false);
    });
  });

  describe('event.send tool', () => {
    it('should have correct tool definition', () => {
      expect(eventSendTool.name).toBe('event.send');
      expect(eventSendTool.description).toContain('InternalEventV2');
      expect(eventSendTool.inputSchema).toBeDefined();
    });

    it('should validate schema with minimal event', () => {
      const validArgs = {
        context: 'local',
        event: {
          type: 'chat.message.v1',
          message: {
            id: 'msg1',
            role: 'user' as const,
            text: 'Hello',
          },
        },
      };

      const result = eventSendTool.inputSchema.safeParse(validArgs);
      expect(result.success).toBe(true);
    });

    it('should validate schema with full event', () => {
      const validArgs = {
        context: 'agent-dev-test',
        event: {
          type: 'chat.message.v1',
          message: {
            id: 'msg1',
            role: 'user' as const,
            text: 'Test message',
          },
          ingress: {
            connector: 'discord',
            source: 'ingress.discord',
            ingressAt: new Date().toISOString(),
          },
          identity: {
            external: {
              id: 'user-123',
              platform: 'discord',
              displayName: 'Test User',
            },
          },
          egress: {
            destination: 'channel-123',
            connector: 'discord',
          },
          annotations: [],
          candidates: [],
        },
        waitForResponse: true,
        timeoutMs: 15000,
      };

      const result = eventSendTool.inputSchema.safeParse(validArgs);
      expect(result.success).toBe(true);
    });

    it('should reject event without type', () => {
      const invalidArgs = {
        context: 'local',
        event: {
          // Missing type
          message: {
            id: 'msg1',
            role: 'user' as const,
          },
        },
      };

      const result = eventSendTool.inputSchema.safeParse(invalidArgs);
      expect(result.success).toBe(false);
    });

    it('should reject invalid message role', () => {
      const invalidArgs = {
        context: 'local',
        event: {
          type: 'chat.message.v1',
          message: {
            id: 'msg1',
            role: 'invalid-role',
            text: 'Test',
          },
        },
      };

      const result = eventSendTool.inputSchema.safeParse(invalidArgs);
      expect(result.success).toBe(false);
    });

    it('should allow passthrough properties on event', () => {
      const validArgs = {
        context: 'local',
        event: {
          type: 'chat.message.v1',
          message: {
            id: 'msg1',
            role: 'user' as const,
          },
          customField: 'custom-value', // Passthrough property
          metadata: { foo: 'bar' }, // Passthrough property
        },
      };

      const result = eventSendTool.inputSchema.safeParse(validArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data.event as any).customField).toBe('custom-value');
      }
    });
  });
});

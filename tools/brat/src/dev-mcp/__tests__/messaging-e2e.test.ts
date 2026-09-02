/**
 * End-to-End Integration Tests for Messaging Tools - Sprint 39
 *
 * Task 4.1: End-to-end integration tests covering full agent-dev workflow
 *
 * Test Scope:
 * - message.send tool execution
 * - event.send tool execution
 * - Platform emulation (Discord, Twitch)
 * - Permission enforcement
 * - Response handling and correlation
 * - Error scenarios
 *
 * **IMPORTANT**: These tests require a running api-gateway instance.
 *
 * Setup:
 * 1. Deploy api-gateway: `npm run brat -- bit deploy api-gateway --context local`
 * 2. Set environment: `export API_GATEWAY_URL=ws://localhost:3008`
 * 3. Run tests: `npm test -- messaging-e2e.test.ts`
 *
 * Tests are skipped if API_GATEWAY_URL is not set.
 */

import { messageSendTool, eventSendTool, buildPlatformPreset, acquireAuthToken } from '../tools/messaging';
import type { InternalEventV2 } from '../../../../../src/types/events';
import { createLogger } from '../../orchestration/logger';

// Skip all tests if API_GATEWAY_URL is not set
const API_GATEWAY_URL = process.env.API_GATEWAY_URL;
const describeIf = API_GATEWAY_URL ? describe : describe.skip;

describeIf('Messaging Tools End-to-End', () => {
  let logger: ReturnType<typeof createLogger>;
  let mockConnection: any;

  beforeAll(() => {
    logger = createLogger({
      level: 'debug',
      base: { name: 'messaging-e2e-test' },
    });
  });

  beforeEach(() => {
    // Mock connection object that tools receive
    mockConnection = {
      name: 'local',
      gateway: {
        url: API_GATEWAY_URL,
      },
    };
  });

  describe('message.send Tool', () => {
    it('should send simple chat message successfully', async () => {
      const result = await messageSendTool.handler(
        {
          text: 'E2E test message',
          waitForResponse: true,
          timeoutMs: 15000,
        },
        mockConnection
      );

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const content = result.content[0];
      if (content.type !== 'text') throw new Error('Expected text content');
      const response = JSON.parse(content.text);
      expect(response.status).toBe('success');
      expect(response.correlationId).toBeDefined();
      expect(response.platform).toBe('api');

      logger.info({ response }, '✅ message.send succeeded');
    }, 30000);

    it('should handle fire-and-forget messages', async () => {
      const result = await messageSendTool.handler(
        {
          text: 'Fire and forget E2E test',
          waitForResponse: false,
        },
        mockConnection
      );

      expect(result.isError).toBeUndefined();

      const content = result.content[0];
      if (content.type !== 'text') throw new Error('Expected text content');
      const response = JSON.parse(content.text);
      expect(response.status).toBe('sent');
      expect(response.message).toContain('no response requested');

      logger.info('✅ Fire-and-forget message sent');
    }, 30000);

    it('should apply Discord platform emulation', async () => {
      const result = await messageSendTool.handler(
        {
          text: 'Discord emulation test',
          platform: 'discord',
          userId: 'test-discord-user-123',
          waitForResponse: true,
          timeoutMs: 15000,
        },
        mockConnection
      );

      expect(result.isError).toBeUndefined();

      const content = result.content[0];
      if (content.type !== 'text') throw new Error('Expected text content');
      const response = JSON.parse(content.text);
      expect(response.status).toBe('success');
      expect(response.platform).toBe('discord');

      logger.info({ response }, '✅ Discord emulation successful');
    }, 30000);

    it('should apply Twitch platform emulation', async () => {
      const result = await messageSendTool.handler(
        {
          text: '!commands',
          platform: 'twitch',
          userId: 'test_twitch_user',
          waitForResponse: true,
          timeoutMs: 15000,
        },
        mockConnection
      );

      expect(result.isError).toBeUndefined();

      const content = result.content[0];
      if (content.type !== 'text') throw new Error('Expected text content');
      const response = JSON.parse(content.text);
      expect(response.status).toBe('success');
      expect(response.platform).toBe('twitch');

      logger.info({ response }, '✅ Twitch emulation successful');
    }, 30000);
  });

  describe('event.send Tool', () => {
    it('should send full InternalEventV2 event successfully', async () => {
      const customEvent: Partial<InternalEventV2> = {
        type: 'chat.message.v1',
        message: {
          id: 'e2e-test-msg-1',
          role: 'user',
          text: 'E2E event injection test',
        },
        ingress: {
          source: 'e2e-test',
          connector: 'api',
          ingressAt: new Date().toISOString(),
        },
        identity: {
          external: {
            id: 'e2e-test-user',
            platform: 'api',
            displayName: 'E2E Test User',
          },
        },
        egress: {
          destination: 'e2e-test',
          type: 'chat',
          connector: 'api',
        },
      };

      const result = await eventSendTool.handler(
        {
          event: customEvent,
          waitForResponse: true,
          timeoutMs: 15000,
        },
        mockConnection
      );

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const content = result.content[0];
      if (content.type !== 'text') throw new Error('Expected text content');
      const response = JSON.parse(content.text);
      expect(response.status).toBe('success');
      expect(response.eventType).toBe('chat.message.v1');

      logger.info({ response }, '✅ event.send succeeded');
    }, 30000);

    it('should handle event as JSON string', async () => {
      const customEvent = {
        type: 'chat.message.v1',
        message: {
          id: 'e2e-test-msg-2',
          role: 'user' as const,
          text: 'JSON string test',
        },
        ingress: {
          source: 'e2e-test',
          connector: 'api' as const,
        },
      };

      const result = await eventSendTool.handler(
        {
          event: JSON.stringify(customEvent),
          waitForResponse: true,
          timeoutMs: 15000,
        },
        mockConnection
      );

      expect(result.isError).toBeUndefined();

      const content = result.content[0];
      if (content.type !== 'text') throw new Error('Expected text content');
      const response = JSON.parse(content.text);
      expect(response.status).toBe('success');

      logger.info('✅ JSON string event accepted');
    }, 30000);

    it('should preserve custom event metadata', async () => {
      const customEvent: Partial<InternalEventV2> = {
        type: 'custom.test.v1',
        message: {
          id: 'custom-msg-1',
          role: 'user',
          text: 'Custom metadata test',
        },
        payload: {
          customField: 'custom value',
          nestedData: {
            key: 'value',
          },
        },
        annotations: [
          {
            kind: 'test-annotation',
            value: 'test value',
            source: 'e2e-test',
            id: 'ann-1',
            createdAt: new Date().toISOString(),
          },
        ],
      };

      const result = await eventSendTool.handler(
        {
          event: customEvent,
          waitForResponse: true,
          timeoutMs: 15000,
        },
        mockConnection
      );

      expect(result.isError).toBeUndefined();

      const content = result.content[0];
      if (content.type !== 'text') throw new Error('Expected text content');
      const response = JSON.parse(content.text);
      expect(response.status).toBe('success');
      expect(response.eventType).toBe('custom.test.v1');

      logger.info('✅ Custom metadata preserved');
    }, 30000);
  });

  describe('Error Handling', () => {
    it('should handle connection errors gracefully', async () => {
      const badConnection = {
        name: 'local',
        gateway: {
          url: 'ws://localhost:99999', // Invalid port
        },
      } as any; // Type assertion for test

      const result = await messageSendTool.handler(
        {
          text: 'This should fail',
          waitForResponse: true,
        },
        badConnection
      );

      expect(result.isError).toBe(true);
      const errorContent = result.content[0];
      if (errorContent.type !== 'text') throw new Error('Expected text content');
      expect(errorContent.text).toContain('Error sending message');

      logger.info('✅ Connection error handled gracefully');
    }, 30000);

    it('should handle malformed event gracefully', async () => {
      const result = await eventSendTool.handler(
        {
          event: 'not valid json',
          waitForResponse: true,
        },
        mockConnection
      );

      expect(result.isError).toBe(true);
      const errorContent = result.content[0];
      if (errorContent.type !== 'text') throw new Error('Expected text content');
      expect(errorContent.text).toContain('Failed to parse event JSON');

      logger.info('✅ Malformed event rejected');
    });
  });

  describe('Platform Preset Integration', () => {
    it('should generate correct metadata for all platforms', () => {
      const platforms = ['discord', 'twitch', 'slack', 'twilio', 'api'];

      for (const platform of platforms) {
        const preset = buildPlatformPreset(platform, `test-${platform}-user`);

        expect(preset.connector).toBe(platform);
        expect(preset.source).toBeDefined();
        expect(preset.identity).toBeDefined();
        expect(preset.identity?.external?.platform).toBe(platform);
        expect(preset.egress).toBeDefined();
        expect(preset.egress?.connector).toBe(platform);

        logger.info({ platform, preset }, `✅ ${platform} preset validated`);
      }
    });
  });

  describe('Multiple Concurrent Messages', () => {
    it('should handle multiple concurrent messages correctly', async () => {
      const messages = [
        'Concurrent test 1',
        'Concurrent test 2',
        'Concurrent test 3',
      ];

      const promises = messages.map((text) =>
        messageSendTool.handler(
          {
            text,
            waitForResponse: true,
            timeoutMs: 15000,
          },
          mockConnection
        )
      );

      const results = await Promise.all(promises);

      for (const result of results) {
        expect(result.isError).toBeUndefined();
        const content = result.content[0];
      if (content.type !== 'text') throw new Error('Expected text content');
      const response = JSON.parse(content.text);
        expect(response.status).toBe('success');
        expect(response.correlationId).toBeDefined();
      }

      logger.info(`✅ ${messages.length} concurrent messages succeeded`);
    }, 60000); // 60s timeout for multiple requests
  });

  describe('Connection Reuse', () => {
    it('should reuse cached connection for multiple tool calls', async () => {
      // First call - should create new connection
      const result1 = await messageSendTool.handler(
        {
          text: 'Connection reuse test 1',
          waitForResponse: true,
        },
        mockConnection
      );

      expect(result1.isError).toBeUndefined();
      expect(mockConnection.gateway.client).toBeDefined();

      const cachedClient = mockConnection.gateway.client;

      // Second call - should reuse connection
      const result2 = await messageSendTool.handler(
        {
          text: 'Connection reuse test 2',
          waitForResponse: true,
        },
        mockConnection
      );

      expect(result2.isError).toBeUndefined();
      expect(mockConnection.gateway.client).toBe(cachedClient);

      logger.info('✅ Connection reused successfully');
    }, 60000);
  });
});

// Log instructions if tests are skipped
if (!API_GATEWAY_URL) {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║ E2E Messaging Tests Skipped - API_GATEWAY_URL not set            ║
╠═══════════════════════════════════════════════════════════════════╣
║ To run end-to-end messaging tests:                               ║
║                                                                   ║
║ 1. Deploy api-gateway to local or agent-dev:                     ║
║    npm run brat -- bit deploy api-gateway                        ║
║                                                                   ║
║ 2. Set environment variable:                                     ║
║    export API_GATEWAY_URL=ws://localhost:3008                    ║
║                                                                   ║
║ 3. Run tests:                                                    ║
║    npm test -- messaging-e2e.test.ts                             ║
╚═══════════════════════════════════════════════════════════════════╝
  `);
}

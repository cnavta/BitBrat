/**
 * Integration tests for ApiGatewayClient
 *
 * Sprint 39: Dev MCP Messaging Tools
 * Task 1.8: Integration test with real api-gateway
 *
 * **IMPORTANT**: These tests require a running api-gateway instance.
 *
 * To run these tests:
 * 1. Deploy api-gateway to an agent-dev context:
 *    `npm run brat -- agent-dev provision --name agent-dev-sprint-39`
 *    `npm run brat -- bit deploy api-gateway --context agent-dev-sprint-39`
 *
 * 2. Set environment variables:
 *    `export API_GATEWAY_URL=ws://localhost:3008`
 *    `export API_GATEWAY_TOKEN=<your-dev-token>` (optional, for authenticated tests)
 *
 * 3. Run tests:
 *    `npm test -- api-gateway-client.integration.test.ts`
 *
 * Tests are skipped if API_GATEWAY_URL is not set.
 */

import { ApiGatewayClient } from '../api-gateway-client';
import type { InternalEventV2 } from '../../../../../src/types/events';
import { createLogger } from '../../orchestration/logger';

// Skip all tests if API_GATEWAY_URL is not set
const API_GATEWAY_URL = process.env.API_GATEWAY_URL;
const API_GATEWAY_TOKEN = process.env.API_GATEWAY_TOKEN;

const describeIf = API_GATEWAY_URL ? describe : describe.skip;

describeIf('ApiGatewayClient Integration', () => {
  let client: ApiGatewayClient;
  let logger: ReturnType<typeof createLogger>;

  beforeAll(() => {
    logger = createLogger({
      level: 'debug',
      base: { name: 'api-gateway-client-integration-test' },
    });
  });

  beforeEach(() => {
    client = new ApiGatewayClient({
      gatewayUrl: API_GATEWAY_URL!,
      authToken: API_GATEWAY_TOKEN,
      logger,
    });
  });

  afterEach(async () => {
    if (client && client.isClientConnected()) {
      await client.disconnect();
    }
  });

  describe('Connection', () => {
    it('should connect to api-gateway', async () => {
      await client.connect();

      expect(client.isClientConnected()).toBe(true);

      logger.info('✅ Successfully connected to api-gateway');
    });

    it('should connect with userId parameter', async () => {
      const clientWithUserId = new ApiGatewayClient({
        gatewayUrl: API_GATEWAY_URL!,
        authToken: API_GATEWAY_TOKEN,
        userId: 'brat-chat:integration-test',
        logger,
      });

      await clientWithUserId.connect();

      expect(clientWithUserId.isClientConnected()).toBe(true);

      await clientWithUserId.disconnect();

      logger.info('✅ Successfully connected with userId parameter');
    });

    it('should disconnect cleanly', async () => {
      await client.connect();
      expect(client.isClientConnected()).toBe(true);

      await client.disconnect();
      expect(client.isClientConnected()).toBe(false);

      logger.info('✅ Disconnect successful');
    });
  });

  describe('Message Sending', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should send chat.message.v1 frame', async () => {
      const response = await client.sendMessage({
        type: 'chat.message.v1',
        payload: {
          text: 'Integration test message',
        },
        waitForResponse: true,
        timeoutMs: 15000,
      });

      expect(response).toBeDefined();
      expect(response?.type).toBeDefined();

      logger.info({ response }, '✅ Received response from api-gateway');
    }, 20000); // 20s timeout for this test

    it('should handle fire-and-forget messages', async () => {
      const response = await client.sendMessage({
        type: 'chat.message.v1',
        payload: {
          text: 'Fire and forget test',
        },
        waitForResponse: false,
      });

      expect(response).toBeNull();

      logger.info('✅ Fire-and-forget message sent');
    });
  });

  describe('Event Injection (event.inject.v2)', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should send event.inject.v2 frame (requires event:inject permission)', async () => {
      if (!API_GATEWAY_TOKEN) {
        logger.warn('⚠️  Skipping event injection test - no auth token provided');
        return;
      }

      const response = await client.sendEvent({
        event: {
          type: 'chat.message.v1',
          message: {
            id: 'test-msg-1',
            role: 'user',
            text: '!help',
          },
          ingress: {
            ingressAt: new Date().toISOString(),
            source: 'integration-test',
            connector: 'api',
          },
          identity: {
            external: {
              id: 'integration-test-user',
              platform: 'api',
              displayName: 'Integration Test User',
            },
          },
          egress: {
            destination: 'integration-test',
            connector: 'api',
          },
        },
        waitForResponse: true,
        timeoutMs: 15000,
      });

      expect(response).toBeDefined();
      expect(response?.type).toBeDefined();

      logger.info({ response }, '✅ Event injection successful');
    }, 20000); // 20s timeout
  });

  describe('Error Handling', () => {
    it('should handle connection to invalid URL', async () => {
      const badClient = new ApiGatewayClient({
        gatewayUrl: 'ws://localhost:99999', // Invalid port
        logger,
      });

      await expect(badClient.connect()).rejects.toThrow();

      logger.info('✅ Connection error handled correctly');
    });

    it('should handle timeout when no response received', async () => {
      await client.connect();

      // Send a message with very short timeout
      await expect(
        client.sendMessage({
          type: 'test.timeout.v1',
          payload: { test: 'timeout' },
          waitForResponse: true,
          timeoutMs: 100, // 100ms timeout
        })
      ).rejects.toThrow(/timeout/i);

      logger.info('✅ Timeout handled correctly');
    }, 10000);
  });

  describe('Real-world Flow', () => {
    it('should complete full chat message flow', async () => {
      await client.connect();

      // Step 1: Send a chat message
      logger.info('Sending chat message...');
      const response1 = await client.sendMessage({
        type: 'chat.message.v1',
        payload: {
          text: 'What is the weather?',
        },
        waitForResponse: true,
        timeoutMs: 30000,
      });

      expect(response1).toBeDefined();
      logger.info({ response: response1 }, 'Received first response');

      // Step 2: Send a follow-up message using the same connection
      logger.info('Sending follow-up message...');
      const response2 = await client.sendMessage({
        type: 'chat.message.v1',
        payload: {
          text: 'Tell me a joke',
        },
        waitForResponse: true,
        timeoutMs: 30000,
      });

      expect(response2).toBeDefined();
      logger.info({ response: response2 }, 'Received second response');

      // Step 3: Disconnect
      await client.disconnect();
      expect(client.isClientConnected()).toBe(false);

      logger.info('✅ Full chat flow completed successfully');
    }, 90000); // 90s timeout for full flow
  });
});

// Log instructions if tests are skipped
if (!API_GATEWAY_URL) {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║ Integration tests skipped - API_GATEWAY_URL not set              ║
╠═══════════════════════════════════════════════════════════════════╣
║ To run integration tests:                                         ║
║                                                                   ║
║ 1. Deploy api-gateway to agent-dev:                              ║
║    npm run brat -- agent-dev provision --name agent-dev-sprint-39║
║    npm run brat -- bit deploy api-gateway \\                      ║
║      --context agent-dev-sprint-39                               ║
║                                                                   ║
║ 2. Set environment variable:                                     ║
║    export API_GATEWAY_URL=ws://localhost:3008                    ║
║    export API_GATEWAY_TOKEN=<optional-dev-token>                 ║
║                                                                   ║
║ 3. Run tests:                                                    ║
║    npm test -- api-gateway-client.integration.test.ts            ║
╚═══════════════════════════════════════════════════════════════════╝
  `);
}

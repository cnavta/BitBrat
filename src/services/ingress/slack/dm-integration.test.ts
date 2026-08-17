/**
 * Slack DM Integration Test (DM-009)
 *
 * Tests DM ingress and egress functionality for Slack integration.
 * Uses the same mocking pattern as other Slack tests to avoid real API calls.
 *
 * @since Sprint 13
 */

import { SlackIngressClient } from './slack-ingress-client';
import { buildSlackEnvelope } from './envelope-builder';
import { createMockSlackMessage } from './debug-test-utils';
import type { InternalEventV2 } from '../../../types/events';
import type { IngressPublisher } from '../core';

// Mock dependencies (hoisted - must be at top level)
jest.mock('../../../common/logging');
jest.mock('@slack/socket-mode');
jest.mock('@slack/web-api');

describe('Slack DM Integration (DM-009)', () => {
  let mockPublisher: jest.Mocked<IngressPublisher>;
  let publishedEvents: InternalEventV2[];
  let mockWebClient: any;

  beforeEach(() => {
    publishedEvents = [];
    mockPublisher = {
      publish: jest.fn().mockImplementation((event: InternalEventV2) => {
        publishedEvents.push(event);
        return Promise.resolve();
      }),
    };

    // Create mock web client
    mockWebClient = {
      auth: {
        test: jest.fn(async () => ({
          user_id: 'bot-user-123',
          team_id: 'T123',
          team: 'Test Team',
          user: 'testbot',
        })),
      },
      chat: {
        postMessage: jest.fn(async (opts: any) => ({
          ok: true,
          ts: '1234567890.123456',
          channel: opts.channel,
        })),
      },
    };
  });

  describe('DM Ingress: Receive DM and normalize to internal event', () => {
    it('should detect DM via channel ID starting with "D" and publish event', async () => {
      const client = new SlackIngressClient(
        buildSlackEnvelope,
        'xapp-test-app-token',
        'xoxb-test-bot-token',
        mockPublisher,
        undefined,
        'internal.egress.v1.proc-xyz'
      );

      // Inject mock webClient (avoid calling real start())
      (client as any).webClient = mockWebClient;
      (client as any).botUserId = 'bot-user-123';

      // Create DM event using test helper
      const dmEvent = createMockSlackMessage({
        text: 'Hello! This is a DM.',
        user: 'U123456789',
        channel: 'D987654321', // DM channel starts with 'D'
        ts: '1723636800.123456',
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(dmEvent);

      // Verify event was published
      // Note: With legacy buildSlackEnvelope, this produces chat.message.v1
      // The DM routing (dm.message.v1) happens in TranslationEngine with YAML config
      // See src/services/ingress/core/regression.test.ts for full DM routing tests
      expect(publishedEvents.length).toBe(1);
      const evt = publishedEvents[0];
      expect(evt).toBeTruthy();
      expect(evt.ingress.source).toBe('ingress.slack');
      expect(evt.message?.text).toBe('Hello! This is a DM.');
      expect(evt.identity?.external?.id).toBe('U123456789');
      expect(evt.egress?.destination).toBe('internal.egress.v1.proc-xyz');
      expect(evt.ingress?.channel).toBe('D987654321'); // DM channel ID
    });

    it('should not publish bot DMs (user === botUserId)', async () => {
      const client = new SlackIngressClient(
        buildSlackEnvelope,
        'xapp-test-app-token',
        'xoxb-test-bot-token',
        mockPublisher
      );

      // Inject mock webClient
      (client as any).webClient = mockWebClient;
      (client as any).botUserId = 'bot-user-123';

      const botDM = createMockSlackMessage({
        user: 'bot-user-123', // Same as bot user ID
        text: 'Bot message',
        channel: 'D999999999',
        ts: '1723636900.654321',
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(botDM);

      // Should not publish bot messages
      expect(publishedEvents.length).toBe(0);
    });

    it('should not publish DMs with bot_id field', async () => {
      const client = new SlackIngressClient(
        buildSlackEnvelope,
        'xapp-test-app-token',
        'xoxb-test-bot-token',
        mockPublisher
      );

      // Inject mock webClient
      (client as any).webClient = mockWebClient;
      (client as any).botUserId = 'bot-user-123';

      // Note: createMockSlackMessage doesn't support bot_id, so create manually
      const appBotDM = {
        type: 'message',
        bot_id: 'B123456789', // App bot message
        text: 'App bot message',
        ts: '1723637000.111111',
        channel: 'D888888888',
      };

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(appBotDM);

      // Should not publish bot messages
      expect(publishedEvents.length).toBe(0);
    });
  });

  describe('DM Egress: Send DM via sendText()', () => {
    it('should send DM using chat.postMessage with DM channel ID', async () => {
      const client = new SlackIngressClient(
        buildSlackEnvelope,
        'xapp-test-app-token',
        'xoxb-test-bot-token',
        mockPublisher
      );

      // Inject mock webClient
      (client as any).webClient = mockWebClient;
      (client as any).botUserId = 'bot-user-123';
      (client as any).state = 'CONNECTED';

      // Send DM to DM channel
      await client.sendText('Test DM content', 'D987654321');

      // Verify chat.postMessage was called correctly
      expect(mockWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: 'D987654321',
        text: 'Test DM content',
      });
    });

    it('should work identically for DM channels and regular channels', async () => {
      const client = new SlackIngressClient(
        buildSlackEnvelope,
        'xapp-test-app-token',
        'xoxb-test-bot-token',
        mockPublisher
      );

      // Inject mock webClient
      (client as any).webClient = mockWebClient;
      (client as any).state = 'CONNECTED';

      // Send to DM channel
      await client.sendText('DM message', 'D123456789');

      // Send to regular channel
      await client.sendText('Channel message', 'C987654321');

      // Both should use the same method with same signature
      expect(mockWebClient.chat.postMessage).toHaveBeenCalledTimes(2);
      expect(mockWebClient.chat.postMessage).toHaveBeenNthCalledWith(1, {
        channel: 'D123456789',
        text: 'DM message',
      });
      expect(mockWebClient.chat.postMessage).toHaveBeenNthCalledWith(2, {
        channel: 'C987654321',
        text: 'Channel message',
      });
    });
  });
});

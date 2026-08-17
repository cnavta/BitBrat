/**
 * Slack Ingress Client - Deduplication Tests
 *
 * Tests for Slack message timestamp-based deduplication to prevent
 * double processing when Slack sends duplicate Socket Mode events.
 *
 * @since Sprint 371 (bugfix)
 */

import { SlackIngressClient } from '../slack-ingress-client';
import { buildSlackEnvelope } from '../envelope-builder';
import { createMockSlackMessage, createMockWebClient } from '../debug-test-utils';
import type { InternalEventV2 } from '../../../../types/events';
import type { IngressPublisher } from '../../core';

// Mock dependencies
jest.mock('../../../../common/logging');
jest.mock('@slack/socket-mode');
jest.mock('@slack/web-api');

describe('SlackIngressClient - Deduplication', () => {
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

    mockWebClient = createMockWebClient();
  });

  describe('Message timestamp deduplication', () => {
    it('should process first message normally', async () => {
      const client = new SlackIngressClient(
        buildSlackEnvelope,
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher
      );

      (client as any).webClient = mockWebClient;

      const slackEvent = createMockSlackMessage({
        text: 'Test message',
        user: 'U_TEST_USER',
        channel: 'C_TEST_CHANNEL',
        ts: '1234567890.123456', // Unique Slack timestamp
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      // Should publish the event
      expect(mockPublisher.publish).toHaveBeenCalledTimes(1);
      expect(publishedEvents).toHaveLength(1);
    });

    it('should deduplicate second message with same timestamp', async () => {
      const client = new SlackIngressClient(
        buildSlackEnvelope,
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher
      );

      (client as any).webClient = mockWebClient;

      const messageTs = '1234567890.123456';

      const slackEvent1 = createMockSlackMessage({
        text: 'Test message',
        user: 'U_TEST_USER',
        channel: 'C_TEST_CHANNEL',
        ts: messageTs,
      });

      const slackEvent2 = createMockSlackMessage({
        text: 'Test message',
        user: 'U_TEST_USER',
        channel: 'C_TEST_CHANNEL',
        ts: messageTs, // Same timestamp = duplicate
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent1);

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent2);

      // Should only publish once (second is deduplicated)
      expect(mockPublisher.publish).toHaveBeenCalledTimes(1);
      expect(publishedEvents).toHaveLength(1);
    });

    it('should increment deduplicated counter', async () => {
      const client = new SlackIngressClient(
        buildSlackEnvelope,
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher
      );

      (client as any).webClient = mockWebClient;

      const messageTs = '1234567890.123456';

      const slackEvent1 = createMockSlackMessage({
        text: 'Test message',
        ts: messageTs,
      });

      const slackEvent2 = createMockSlackMessage({
        text: 'Test message',
        ts: messageTs,
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent1);

      const snapshot1 = client.getSnapshot();
      expect(snapshot1.counters?.deduplicated).toBe(0);

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent2);

      const snapshot2 = client.getSnapshot();
      expect(snapshot2.counters?.deduplicated).toBe(1);
    });

    it('should process messages with different timestamps', async () => {
      const client = new SlackIngressClient(
        buildSlackEnvelope,
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher
      );

      (client as any).webClient = mockWebClient;

      const slackEvent1 = createMockSlackMessage({
        text: 'First message',
        ts: '1234567890.111111',
      });

      const slackEvent2 = createMockSlackMessage({
        text: 'Second message',
        ts: '1234567890.222222', // Different timestamp
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent1);

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent2);

      // Should publish both
      expect(mockPublisher.publish).toHaveBeenCalledTimes(2);
      expect(publishedEvents).toHaveLength(2);
    });

    it('should handle messages without timestamp', async () => {
      const client = new SlackIngressClient(
        buildSlackEnvelope,
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher
      );

      (client as any).webClient = mockWebClient;

      const slackEvent = createMockSlackMessage({
        text: 'Test message',
        // No ts field
      });

      // Remove ts from event
      delete (slackEvent.event as any).ts;

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      // Should still process (no deduplication if no timestamp)
      expect(mockPublisher.publish).toHaveBeenCalledTimes(1);
    });

    it('should use event_ts as fallback if ts not present', async () => {
      const client = new SlackIngressClient(
        buildSlackEnvelope,
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher
      );

      (client as any).webClient = mockWebClient;

      const eventTs = '1234567890.123456';

      const slackEvent1 = createMockSlackMessage({
        text: 'Test message',
      });

      const slackEvent2 = createMockSlackMessage({
        text: 'Test message',
      });

      // Set event_ts instead of ts
      delete (slackEvent1.event as any).ts;
      (slackEvent1.event as any).event_ts = eventTs;

      delete (slackEvent2.event as any).ts;
      (slackEvent2.event as any).event_ts = eventTs;

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent1);

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent2);

      // Should deduplicate using event_ts
      expect(mockPublisher.publish).toHaveBeenCalledTimes(1);
    });

    it('should log warning when deduplicating', async () => {
      const client = new SlackIngressClient(
        buildSlackEnvelope,
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher
      );

      (client as any).webClient = mockWebClient;

      const messageTs = '1234567890.123456';

      const slackEvent1 = createMockSlackMessage({
        text: 'Test message',
        ts: messageTs,
      });

      const slackEvent2 = createMockSlackMessage({
        text: 'Test message',
        ts: messageTs,
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent1);

      const { logger } = require('../../../../common/logging');
      logger.warn = jest.fn();

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent2);

      // Should log warning for duplicate
      expect(logger.warn).toHaveBeenCalledWith(
        'slack.client.message_deduplicated',
        expect.objectContaining({
          ts: messageTs,
        })
      );
    });
  });

  describe('Deduplication cache cleanup', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should clear deduplication cache periodically', async () => {
      const client = new SlackIngressClient(
        buildSlackEnvelope,
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher
      );

      (client as any).webClient = mockWebClient;

      // Start client to initialize cleanup interval
      // Mock the socket client start
      const mockSocketClient = {
        start: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
        disconnect: jest.fn(),
      };
      (client as any).socketClient = mockSocketClient;

      await client.start();

      const messageTs = '1234567890.123456';

      const slackEvent1 = createMockSlackMessage({
        text: 'Test message',
        ts: messageTs,
      });

      const slackEvent2 = createMockSlackMessage({
        text: 'Test message',
        ts: messageTs,
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent1);

      // Should deduplicate immediately
      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent2);

      expect(mockPublisher.publish).toHaveBeenCalledTimes(1);

      // Fast-forward 60 seconds to trigger cache cleanup
      jest.advanceTimersByTime(60000);

      // After cleanup, same timestamp should be processed again
      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent2);

      expect(mockPublisher.publish).toHaveBeenCalledTimes(2);

      await client.stop();
    });

    it('should clear cleanup interval on stop', async () => {
      const client = new SlackIngressClient(
        buildSlackEnvelope,
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher
      );

      const mockSocketClient = {
        start: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
        disconnect: jest.fn().mockResolvedValue(undefined),
      };
      (client as any).socketClient = mockSocketClient;

      // Mock webClient.auth.test
      (client as any).webClient = {
        auth: {
          test: jest.fn().mockResolvedValue({ user_id: 'U_BOT' }),
        },
      };

      await client.start();

      // Verify interval is set
      expect((client as any).deduplicationCleanupInterval).toBeDefined();

      await client.stop();

      // Verify interval is cleared
      expect((client as any).deduplicationCleanupInterval).toBeUndefined();
    });
  });
});

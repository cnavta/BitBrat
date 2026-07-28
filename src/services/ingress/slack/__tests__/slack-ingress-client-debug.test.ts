/**
 * Slack Ingress Client - Debug Mode Tests (Sprint 371)
 *
 * Tests for debug command detection (!debug prefix) in SlackIngressClient.
 *
 * @since Sprint 371
 */

import { SlackIngressClient } from '../slack-ingress-client';
import { createMockSlackMessage } from './debug-fixtures';
import type { InternalEventV2 } from '../../../../types/events';
import type { IngressPublisher } from '../../core';

// Mock dependencies
jest.mock('../../../../common/logging');
jest.mock('@slack/socket-mode');
jest.mock('@slack/web-api');

describe('SlackIngressClient - Debug Mode Detection (DBG-005)', () => {
  let client: SlackIngressClient;
  let mockPublisher: jest.Mocked<IngressPublisher>;
  let publishedEvents: InternalEventV2[];

  beforeEach(() => {
    publishedEvents = [];
    mockPublisher = {
      publish: jest.fn().mockImplementation((event: InternalEventV2) => {
        publishedEvents.push(event);
        return Promise.resolve();
      }),
    };

    client = new SlackIngressClient(
      'xapp-test-token',
      'xoxb-test-token',
      mockPublisher
    );
  });

  describe('Debug command detection', () => {
    it('should detect !debug prefix (case insensitive)', async () => {
      const testCases = [
        '!debug test message',
        '!DEBUG test message',
        '!DeBuG test message',
        '!debug    test message', // multiple spaces
      ];

      for (const text of testCases) {
        publishedEvents = [];
        const slackEvent = createMockSlackMessage({ text });

        // @ts-expect-error - accessing private method for testing
        await client.handleMessage(slackEvent);

        expect(mockPublisher.publish).toHaveBeenCalled();
        const publishedEvent = publishedEvents[0];
        expect(publishedEvent).toBeDefined();
        // Debug prefix should be stripped
        expect(publishedEvent.message?.text).not.toMatch(/^!debug/i);
      }
    });

    it('should strip debug prefix from message text', async () => {
      const slackEvent = createMockSlackMessage({ text: '!debug What time is it?' });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      expect(mockPublisher.publish).toHaveBeenCalled();
      const publishedEvent = publishedEvents[0];
      expect(publishedEvent.message?.text).toBe('What time is it?');
    });

    it('should handle debug command with minimal spacing', async () => {
      const slackEvent = createMockSlackMessage({ text: '!debug test' });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      expect(mockPublisher.publish).toHaveBeenCalled();
      const publishedEvent = publishedEvents[0];
      expect(publishedEvent.message?.text).toBe('test');
    });

    it('should not detect debug prefix in middle of message', async () => {
      const slackEvent = createMockSlackMessage({ text: 'This is !debug not a debug command' });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      expect(mockPublisher.publish).toHaveBeenCalled();
      const publishedEvent = publishedEvents[0];
      // Text should be unchanged (no debug detection)
      expect(publishedEvent.message?.text).toBe('This is !debug not a debug command');
    });

    it('should handle normal messages without debug prefix', async () => {
      const slackEvent = createMockSlackMessage({ text: 'Hello, world!' });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      expect(mockPublisher.publish).toHaveBeenCalled();
      const publishedEvent = publishedEvents[0];
      // Text should be unchanged
      expect(publishedEvent.message?.text).toBe('Hello, world!');
    });

    it('should handle empty message text gracefully', async () => {
      const slackEvent = createMockSlackMessage({ text: '' });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      expect(mockPublisher.publish).toHaveBeenCalled();
      const publishedEvent = publishedEvents[0];
      expect(publishedEvent.message?.text).toBe('');
    });

    it('should preserve original user and channel info', async () => {
      const slackEvent = createMockSlackMessage({
        text: '!debug test',
        user: 'U0123456789',
        channel: 'C9876543210',
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      expect(mockPublisher.publish).toHaveBeenCalled();
      const publishedEvent = publishedEvents[0];
      expect(publishedEvent.identity?.external?.id).toBe('U0123456789');
      expect(publishedEvent.ingress?.channel).toBe('C9876543210');
      expect(publishedEvent.egress?.channel).toBe('C9876543210');
    });
  });

  describe('Regression tests (non-debug messages)', () => {
    it('should not affect normal message processing', async () => {
      const slackEvent = createMockSlackMessage({
        text: 'Normal message',
        user: 'U1111111111',
        channel: 'C2222222222',
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      expect(mockPublisher.publish).toHaveBeenCalledTimes(1);
      const publishedEvent = publishedEvents[0];
      expect(publishedEvent.message?.text).toBe('Normal message');
      expect(publishedEvent.identity?.external?.id).toBe('U1111111111');
      expect(publishedEvent.type).toBe('chat.message.v1');
    });

    it('should handle messages with punctuation normally', async () => {
      const slackEvent = createMockSlackMessage({
        text: 'Hello! How are you?',
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      expect(mockPublisher.publish).toHaveBeenCalled();
      const publishedEvent = publishedEvents[0];
      expect(publishedEvent.message?.text).toBe('Hello! How are you?');
    });

    it('should handle multi-line messages normally', async () => {
      const slackEvent = createMockSlackMessage({
        text: 'Line 1\nLine 2\nLine 3',
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      expect(mockPublisher.publish).toHaveBeenCalled();
      const publishedEvent = publishedEvents[0];
      expect(publishedEvent.message?.text).toBe('Line 1\nLine 2\nLine 3');
    });
  });
});

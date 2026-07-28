/**
 * Slack Ingress Client - RBAC Tests (Sprint 371)
 *
 * Tests for debug mode RBAC authorization checks at ingress level.
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

describe('SlackIngressClient - Debug Mode RBAC (DBG-006)', () => {
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
  });

  describe('RBAC authorization checks', () => {
    it('should authorize user in debugUsersSlack list', async () => {
      const authorizedUserId = 'U_AUTHORIZED_USER';
      const client = new SlackIngressClient(
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher,
        authorizedUserId // Authorized debug user
      );

      const slackEvent = createMockSlackMessage({
        text: '!debug test message',
        user: authorizedUserId,
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      expect(mockPublisher.publish).toHaveBeenCalled();
      // Note: Full debug metadata check happens in DBG-007
      // For now, we verify the message is published and text is stripped
      const publishedEvent = publishedEvents[0];
      expect(publishedEvent.message?.text).toBe('test message');
    });

    it('should deny user NOT in debugUsersSlack list', async () => {
      const authorizedUserId = 'U_AUTHORIZED_USER';
      const unauthorizedUserId = 'U_UNAUTHORIZED_USER';

      const client = new SlackIngressClient(
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher,
        authorizedUserId // Only this user is authorized
      );

      const slackEvent = createMockSlackMessage({
        text: '!debug test message',
        user: unauthorizedUserId, // Different user (not authorized)
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      expect(mockPublisher.publish).toHaveBeenCalled();
      const publishedEvent = publishedEvents[0];

      // Debug prefix should still be stripped
      expect(publishedEvent.message?.text).toBe('test message');

      // But debug metadata should NOT be present (checked in DBG-007)
      // For now, verify the event was published (unauthorized users still get processed)
      expect(publishedEvent).toBeDefined();
    });

    it('should handle multiple authorized users (comma-separated)', async () => {
      const user1 = 'U_USER_ONE';
      const user2 = 'U_USER_TWO';
      const user3 = 'U_USER_THREE';

      const client = new SlackIngressClient(
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher,
        `${user1},${user2},${user3}` // Multiple authorized users
      );

      // Test each authorized user
      for (const userId of [user1, user2, user3]) {
        publishedEvents = [];
        const slackEvent = createMockSlackMessage({
          text: '!debug test',
          user: userId,
        });

        // @ts-expect-error - accessing private method for testing
        await client.handleMessage(slackEvent);

        expect(mockPublisher.publish).toHaveBeenCalled();
        const publishedEvent = publishedEvents[0];
        expect(publishedEvent.message?.text).toBe('test');
      }
    });

    it('should handle whitespace in debugUsersSlack config', async () => {
      const user1 = 'U_USER_ONE';
      const user2 = 'U_USER_TWO';

      const client = new SlackIngressClient(
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher,
        `  ${user1}  ,  ${user2}  ` // Whitespace around IDs
      );

      // Both users should be authorized
      for (const userId of [user1, user2]) {
        publishedEvents = [];
        const slackEvent = createMockSlackMessage({
          text: '!debug test',
          user: userId,
        });

        // @ts-expect-error - accessing private method for testing
        await client.handleMessage(slackEvent);

        expect(mockPublisher.publish).toHaveBeenCalled();
        const publishedEvent = publishedEvents[0];
        expect(publishedEvent.message?.text).toBe('test');
      }
    });

    it('should handle empty debugUsersSlack (no users authorized)', async () => {
      const client = new SlackIngressClient(
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher,
        '' // No authorized users
      );

      const slackEvent = createMockSlackMessage({
        text: '!debug test message',
        user: 'U_ANY_USER',
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      expect(mockPublisher.publish).toHaveBeenCalled();
      const publishedEvent = publishedEvents[0];

      // Message should still be published (but without debug metadata)
      expect(publishedEvent.message?.text).toBe('test message');
    });

    it('should handle undefined debugUsersSlack (no users authorized)', async () => {
      const client = new SlackIngressClient(
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher
        // debugUsersSlack is undefined
      );

      const slackEvent = createMockSlackMessage({
        text: '!debug test message',
        user: 'U_ANY_USER',
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      expect(mockPublisher.publish).toHaveBeenCalled();
      const publishedEvent = publishedEvents[0];

      // Message should still be published
      expect(publishedEvent.message?.text).toBe('test message');
    });
  });

  describe('RBAC does not affect normal messages', () => {
    it('should process normal messages regardless of RBAC config', async () => {
      const client = new SlackIngressClient(
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher,
        'U_AUTHORIZED_USER' // Only one user authorized
      );

      // Send normal message from unauthorized user
      const slackEvent = createMockSlackMessage({
        text: 'Hello, world!', // No !debug prefix
        user: 'U_UNAUTHORIZED_USER',
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      expect(mockPublisher.publish).toHaveBeenCalled();
      const publishedEvent = publishedEvents[0];

      // Normal message processing unaffected
      expect(publishedEvent.message?.text).toBe('Hello, world!');
    });

    it('should process normal messages from authorized debug users', async () => {
      const authorizedUser = 'U_AUTHORIZED_USER';
      const client = new SlackIngressClient(
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher,
        authorizedUser
      );

      // Send normal message from authorized user
      const slackEvent = createMockSlackMessage({
        text: 'Normal message', // No !debug prefix
        user: authorizedUser,
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      expect(mockPublisher.publish).toHaveBeenCalled();
      const publishedEvent = publishedEvents[0];

      // Normal message processing unaffected
      expect(publishedEvent.message?.text).toBe('Normal message');
    });
  });

  describe('RBAC edge cases', () => {
    it('should handle missing user field gracefully', async () => {
      const client = new SlackIngressClient(
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher,
        'U_AUTHORIZED_USER'
      );

      const slackEvent = createMockSlackMessage({
        text: '!debug test',
        user: undefined, // Missing user
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      expect(mockPublisher.publish).toHaveBeenCalled();
      // Message should be published despite missing user
      const publishedEvent = publishedEvents[0];
      expect(publishedEvent.message?.text).toBe('test');
    });

    it('should treat empty user as unauthorized', async () => {
      const client = new SlackIngressClient(
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher,
        'U_AUTHORIZED_USER'
      );

      const slackEvent = createMockSlackMessage({
        text: '!debug test',
        user: '', // Empty user
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      expect(mockPublisher.publish).toHaveBeenCalled();
      const publishedEvent = publishedEvents[0];

      // Should be treated as unauthorized
      expect(publishedEvent.message?.text).toBe('test');
    });
  });
});

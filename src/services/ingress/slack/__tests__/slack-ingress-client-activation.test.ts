/**
 * Slack Ingress Client - Activation Confirmation Tests (Sprint 371)
 *
 * Tests for debug mode activation confirmation messages.
 *
 * @since Sprint 371
 */

import { SlackIngressClient } from '../slack-ingress-client';
import { createMockSlackMessage, createMockWebClient } from '../debug-test-utils';
import type { InternalEventV2 } from '../../../../types/events';
import type { IngressPublisher } from '../../core';

// Mock dependencies
jest.mock('../../../../common/logging');
jest.mock('@slack/socket-mode');
jest.mock('@slack/web-api');

describe('SlackIngressClient - Activation Confirmation (DBG-008)', () => {
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

  describe('Activation confirmation for authorized users', () => {
    it('should send activation confirmation message when debug mode authorized', async () => {
      const authorizedUser = 'U_AUTHORIZED_USER';
      const channel = 'C_TEST_CHANNEL';

      const client = new SlackIngressClient(
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher,
        authorizedUser
      );

      // Inject mock webClient
      (client as any).webClient = mockWebClient;

      const slackEvent = createMockSlackMessage({
        text: '!debug test message',
        user: authorizedUser,
        channel,
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      // Verify activation message was sent
      expect(mockWebClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel,
          text: expect.stringContaining('Debug mode ON'),
        })
      );

      // Verify message includes correlation ID
      const call = mockWebClient.chat.postMessage.mock.calls[0][0];
      expect(call.text).toMatch(/Correlation ID/);
      expect(call.text).toMatch(/Watching event flow/);
    });

    it('should send activation BEFORE publishing envelope to bus', async () => {
      const authorizedUser = 'U_AUTHORIZED_USER';
      const callOrder: string[] = [];

      const client = new SlackIngressClient(
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher,
        authorizedUser
      );

      // Track call order
      mockWebClient.chat.postMessage = jest.fn().mockImplementation(async () => {
        callOrder.push('activation_message');
        return { ok: true, ts: '123.456' };
      });

      mockPublisher.publish = jest.fn().mockImplementation(async () => {
        callOrder.push('envelope_published');
        return Promise.resolve();
      });

      (client as any).webClient = mockWebClient;

      const slackEvent = createMockSlackMessage({
        text: '!debug test',
        user: authorizedUser,
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      // Activation message should be sent BEFORE envelope is published
      expect(callOrder).toEqual(['activation_message', 'envelope_published']);
    });

    it('should use same correlation ID in activation message and envelope', async () => {
      const authorizedUser = 'U_AUTHORIZED_USER';

      const client = new SlackIngressClient(
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher,
        authorizedUser
      );

      (client as any).webClient = mockWebClient;

      const slackEvent = createMockSlackMessage({
        text: '!debug test',
        user: authorizedUser,
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      // Extract correlation ID from activation message
      const activationCall = mockWebClient.chat.postMessage.mock.calls[0][0];
      const activationText = activationCall.text;
      const correlationIdMatch = activationText.match(/`([a-f0-9-]{36})`/);
      expect(correlationIdMatch).not.toBeNull();
      const correlationIdFromMessage = correlationIdMatch![1];

      // Verify envelope has same correlation ID
      expect(publishedEvents).toHaveLength(1);
      const envelope = publishedEvents[0];
      expect(envelope.correlationId).toBe(correlationIdFromMessage);
    });

    it('should continue processing even if activation message fails', async () => {
      const authorizedUser = 'U_AUTHORIZED_USER';

      const client = new SlackIngressClient(
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher,
        authorizedUser
      );

      // Mock activation message failure
      mockWebClient.chat.postMessage = jest.fn().mockRejectedValue(
        new Error('slack_api_error')
      );

      (client as any).webClient = mockWebClient;

      const slackEvent = createMockSlackMessage({
        text: '!debug test',
        user: authorizedUser,
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      // Envelope should still be published despite activation failure
      expect(mockPublisher.publish).toHaveBeenCalled();
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0].message?.text).toBe('test');
    });
  });

  describe('No activation confirmation for unauthorized users', () => {
    it('should NOT send activation message when user unauthorized', async () => {
      const authorizedUser = 'U_AUTHORIZED_USER';
      const unauthorizedUser = 'U_UNAUTHORIZED_USER';

      const client = new SlackIngressClient(
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher,
        authorizedUser // Only this user is authorized
      );

      (client as any).webClient = mockWebClient;

      const slackEvent = createMockSlackMessage({
        text: '!debug test',
        user: unauthorizedUser, // Different user
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      // No activation message should be sent
      expect(mockWebClient.chat.postMessage).not.toHaveBeenCalled();

      // Envelope should still be published (but without debug metadata)
      expect(mockPublisher.publish).toHaveBeenCalled();
    });

    it('should NOT send activation message for normal messages', async () => {
      const authorizedUser = 'U_AUTHORIZED_USER';

      const client = new SlackIngressClient(
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher,
        authorizedUser
      );

      (client as any).webClient = mockWebClient;

      const slackEvent = createMockSlackMessage({
        text: 'Normal message without debug prefix',
        user: authorizedUser,
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      // No activation message for normal messages
      expect(mockWebClient.chat.postMessage).not.toHaveBeenCalled();

      // Normal message should be published
      expect(mockPublisher.publish).toHaveBeenCalled();
    });
  });

  describe('Activation message format', () => {
    it('should include debug mode indicator emoji', async () => {
      const authorizedUser = 'U_AUTHORIZED_USER';

      const client = new SlackIngressClient(
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher,
        authorizedUser
      );

      (client as any).webClient = mockWebClient;

      const slackEvent = createMockSlackMessage({
        text: '!debug test',
        user: authorizedUser,
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      const call = mockWebClient.chat.postMessage.mock.calls[0][0];
      expect(call.text).toMatch(/🔍/);
    });

    it('should use Slack markdown formatting', async () => {
      const authorizedUser = 'U_AUTHORIZED_USER';

      const client = new SlackIngressClient(
        'xapp-test-token',
        'xoxb-test-token',
        mockPublisher,
        authorizedUser
      );

      (client as any).webClient = mockWebClient;

      const slackEvent = createMockSlackMessage({
        text: '!debug test',
        user: authorizedUser,
      });

      // @ts-expect-error - accessing private method for testing
      await client.handleMessage(slackEvent);

      const call = mockWebClient.chat.postMessage.mock.calls[0][0];
      // Bold text
      expect(call.text).toMatch(/\*Debug mode ON\*/);
      // Code formatting for correlation ID
      expect(call.text).toMatch(/`Correlation ID:`/);
      // Italic for watching message
      expect(call.text).toMatch(/_Watching event flow\.\.\._/);
    });
  });
});

/**
 * SlackConnectorAdapter Webhook Tests
 *
 * Tests for WebhookConnector interface methods.
 * Validates signature verification, URL verification challenge, event callbacks.
 *
 * Sprint 348: Slack Integration (SLACK-007)
 *
 * @since Sprint 348
 */

import { SlackConnectorAdapter } from '../connector-adapter';
import { SlackIngressClient } from '../slack-ingress-client';
import type { WebhookRequest, IngressPublisher } from '../../core';
import type { IConfig } from '../../../../types';
import crypto from 'crypto';

describe('SlackConnectorAdapter - WebhookConnector', () => {
  let adapter: SlackConnectorAdapter;
  let mockPublisher: IngressPublisher;
  let mockClient: SlackIngressClient;
  let mockConfig: IConfig;

  const SECRET = 'test-signing-secret';

  function generateValidSignature(timestamp: string, body: Record<string, any>): string {
    const bodyString = JSON.stringify(body);
    const basestring = `v0:${timestamp}:${bodyString}`;
    const hmac = crypto.createHmac('sha256', SECRET);
    hmac.update(basestring);
    return `v0=${hmac.digest('hex')}`;
  }

  beforeEach(() => {
    mockPublisher = {
      publish: jest.fn().mockResolvedValue(undefined),
    };

    mockClient = new SlackIngressClient(
      'xapp-test-app-token',
      'xoxb-test-bot-token',
      mockPublisher
    );

    mockConfig = {
      slackSigningSecret: SECRET,
    } as IConfig;

    adapter = new SlackConnectorAdapter(mockClient, mockConfig);
  });

  describe('verifySignature', () => {
    it('should pass with valid signature', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = { type: 'url_verification', challenge: 'test123' };
      const signature = generateValidSignature(timestamp, body);

      const req: WebhookRequest = {
        headers: {
          'x-slack-signature': signature,
          'x-slack-request-timestamp': timestamp,
        },
        body,
        url: '/webhooks/slack',
        method: 'POST',
      };

      const result = adapter.verifySignature(req);

      expect(result).toBe(true);
    });

    it('should fail with invalid signature', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = { type: 'url_verification', challenge: 'test123' };

      const req: WebhookRequest = {
        headers: {
          'x-slack-signature': 'v0=invalid_signature',
          'x-slack-request-timestamp': timestamp,
        },
        body,
        url: '/webhooks/slack',
        method: 'POST',
      };

      const result = adapter.verifySignature(req);

      expect(result).toBe(false);
    });

    it('should fail with missing x-slack-signature header', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = { type: 'url_verification', challenge: 'test123' };

      const req: WebhookRequest = {
        headers: {
          'x-slack-request-timestamp': timestamp,
        },
        body,
        url: '/webhooks/slack',
        method: 'POST',
      };

      const result = adapter.verifySignature(req);

      expect(result).toBe(false);
    });

    it('should fail with missing x-slack-request-timestamp header', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = { type: 'url_verification', challenge: 'test123' };
      const signature = generateValidSignature(timestamp, body);

      const req: WebhookRequest = {
        headers: {
          'x-slack-signature': signature,
        },
        body,
        url: '/webhooks/slack',
        method: 'POST',
      };

      const result = adapter.verifySignature(req);

      expect(result).toBe(false);
    });

    it('should fail with expired timestamp (> 5 minutes)', () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - (6 * 60); // 6 minutes ago
      const timestamp = String(oldTimestamp);
      const body = { type: 'url_verification', challenge: 'test123' };
      const signature = generateValidSignature(timestamp, body);

      const req: WebhookRequest = {
        headers: {
          'x-slack-signature': signature,
          'x-slack-request-timestamp': timestamp,
        },
        body,
        url: '/webhooks/slack',
        method: 'POST',
      };

      const result = adapter.verifySignature(req);

      expect(result).toBe(false);
    });

    it('should fail with malformed signature (missing v0 prefix)', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = { type: 'url_verification', challenge: 'test123' };
      const signature = generateValidSignature(timestamp, body).replace('v0=', '');

      const req: WebhookRequest = {
        headers: {
          'x-slack-signature': signature,
          'x-slack-request-timestamp': timestamp,
        },
        body,
        url: '/webhooks/slack',
        method: 'POST',
      };

      const result = adapter.verifySignature(req);

      expect(result).toBe(false);
    });

    it('should fail when signing secret is not configured', () => {
      const adapterWithoutSecret = new SlackConnectorAdapter(mockClient, {} as IConfig);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = { type: 'url_verification', challenge: 'test123' };
      const signature = generateValidSignature(timestamp, body);

      const req: WebhookRequest = {
        headers: {
          'x-slack-signature': signature,
          'x-slack-request-timestamp': timestamp,
        },
        body,
        url: '/webhooks/slack',
        method: 'POST',
      };

      const result = adapterWithoutSecret.verifySignature(req);

      expect(result).toBe(false);
    });
  });

  describe('handleWebhook', () => {
    describe('URL verification challenge', () => {
      it('should return challenge value with 200 OK', async () => {
        const req: WebhookRequest = {
          headers: {},
          body: {
            type: 'url_verification',
            challenge: 'test-challenge-value-abc123',
          },
          url: '/webhooks/slack',
          method: 'POST',
        };

        const response = await adapter.handleWebhook(req);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ challenge: 'test-challenge-value-abc123' });
      });

      it('should handle URL verification without publishing events', async () => {
        const req: WebhookRequest = {
          headers: {},
          body: {
            type: 'url_verification',
            challenge: 'test-challenge',
          },
          url: '/webhooks/slack',
          method: 'POST',
        };

        await adapter.handleWebhook(req);

        // Should not publish any events for URL verification
        expect(mockPublisher.publish).not.toHaveBeenCalled();
      });
    });

    describe('Event callbacks', () => {
      it('should return 200 OK immediately (< 100ms)', async () => {
        const req: WebhookRequest = {
          headers: {},
          body: {
            type: 'event_callback',
            event: {
              type: 'message',
              user: 'U123456',
              channel: 'C123456',
              text: 'Hello!',
              ts: '1234567890.123456',
            },
          },
          url: '/webhooks/slack',
          method: 'POST',
        };

        const startTime = Date.now();
        const response = await adapter.handleWebhook(req);
        const duration = Date.now() - startTime;

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ ok: true });
        expect(duration).toBeLessThan(100); // < 100ms response time
      });

      it('should process event asynchronously (setImmediate)', async () => {
        const req: WebhookRequest = {
          headers: {},
          body: {
            type: 'event_callback',
            event: {
              type: 'message',
              user: 'U123456',
              channel: 'C123456',
              text: 'Test message',
              ts: '1234567890.123456',
            },
          },
          url: '/webhooks/slack',
          method: 'POST',
        };

        const response = await adapter.handleWebhook(req);

        // Response returned immediately
        expect(response.status).toBe(200);

        // Event not yet published (async processing)
        expect(mockPublisher.publish).not.toHaveBeenCalled();

        // Wait for setImmediate to complete
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setTimeout(resolve, 10));

        // Now event should be published
        expect(mockPublisher.publish).toHaveBeenCalledTimes(1);
      });

      it('should publish envelope to event-router', async () => {
        const req: WebhookRequest = {
          headers: {},
          body: {
            type: 'event_callback',
            event: {
              type: 'message',
              user: 'U123456',
              channel: 'C123456',
              text: 'Hello, world!',
              ts: '1234567890.123456',
              team: 'T123456',
            },
          },
          url: '/webhooks/slack',
          method: 'POST',
        };

        await adapter.handleWebhook(req);

        // Wait for async processing
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockPublisher.publish).toHaveBeenCalledTimes(1);

        const publishedEvent = (mockPublisher.publish as jest.Mock).mock.calls[0][0];
        expect(publishedEvent.v).toBe('2');
        expect(publishedEvent.type).toBe('chat.message.v1');
        expect(publishedEvent.ingress.connector).toBe('slack');
        expect(publishedEvent.message?.text).toBe('Hello, world!');
      });

      it('should handle errors gracefully (logs, does not throw)', async () => {
        // Mock publisher to throw error
        mockPublisher.publish = jest.fn().mockRejectedValue(new Error('publish_failed'));

        const req: WebhookRequest = {
          headers: {},
          body: {
            type: 'event_callback',
            event: {
              type: 'message',
              user: 'U123456',
              channel: 'C123456',
              text: 'Test',
              ts: '1234567890.123456',
            },
          },
          url: '/webhooks/slack',
          method: 'POST',
        };

        // Should not throw
        const response = await adapter.handleWebhook(req);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ ok: true });

        // Wait for async processing
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setTimeout(resolve, 10));

        // Error should be logged, not thrown
        expect(mockPublisher.publish).toHaveBeenCalled();
      });

      it('should handle app_mention events', async () => {
        const req: WebhookRequest = {
          headers: {},
          body: {
            type: 'event_callback',
            event: {
              type: 'app_mention',
              user: 'U123456',
              channel: 'C123456',
              text: '<@U987654> hello bot!',
              ts: '1234567890.123456',
            },
          },
          url: '/webhooks/slack',
          method: 'POST',
        };

        await adapter.handleWebhook(req);

        // Wait for async processing
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockPublisher.publish).toHaveBeenCalledTimes(1);

        const publishedEvent = (mockPublisher.publish as jest.Mock).mock.calls[0][0];
        expect(publishedEvent.message?.rawPlatformPayload?.type).toBe('app_mention');
      });

      it('should handle threaded messages', async () => {
        const req: WebhookRequest = {
          headers: {},
          body: {
            type: 'event_callback',
            event: {
              type: 'message',
              user: 'U123456',
              channel: 'C123456',
              text: 'Reply in thread',
              ts: '1234567890.123456',
              thread_ts: '1234567800.000000',
            },
          },
          url: '/webhooks/slack',
          method: 'POST',
        };

        await adapter.handleWebhook(req);

        // Wait for async processing
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setTimeout(resolve, 10));

        const publishedEvent = (mockPublisher.publish as jest.Mock).mock.calls[0][0];
        expect(publishedEvent.identity.external.metadata?.threadTs).toBe('1234567800.000000');
      });
    });

    describe('Unsupported event types', () => {
      it('should return 400 Bad Request for unknown event types', async () => {
        const req: WebhookRequest = {
          headers: {},
          body: {
            type: 'unknown_event_type',
          },
          url: '/webhooks/slack',
          method: 'POST',
        };

        const response = await adapter.handleWebhook(req);

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'unsupported_event_type' });
      });

      it('should not publish events for unsupported types', async () => {
        const req: WebhookRequest = {
          headers: {},
          body: {
            type: 'unsupported_type',
          },
          url: '/webhooks/slack',
          method: 'POST',
        };

        await adapter.handleWebhook(req);

        // Wait to ensure no async processing
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockPublisher.publish).not.toHaveBeenCalled();
      });
    });
  });

  describe('getMetadata', () => {
    it('should return platform as "slack"', () => {
      const metadata = adapter.getMetadata();

      expect(metadata.platform).toBe('slack');
    });

    it('should return version', () => {
      const metadata = adapter.getMetadata();

      expect(metadata.version).toBe('1.0.0');
    });

    it('should return authMethod as oauth2', () => {
      const metadata = adapter.getMetadata();

      expect(metadata.authMethod).toBe('oauth2');
    });

    it('should return capabilities.ingress.method as "hybrid"', () => {
      const metadata = adapter.getMetadata();

      expect(metadata.capabilities.ingress.method).toBe('hybrid');
      expect(metadata.capabilities.ingress.realtime).toBe(true);
      expect(metadata.capabilities.ingress.requiresWebhook).toBe(false);
      expect(metadata.capabilities.ingress.requiresPublicUrl).toBe(false);
    });

    it('should return capabilities.egress.threads as true', () => {
      const metadata = adapter.getMetadata();

      expect(metadata.capabilities.egress.chat).toBe(true);
      expect(metadata.capabilities.egress.dm).toBe(true);
      expect(metadata.capabilities.egress.reactions).toBe(true);
      expect(metadata.capabilities.egress.threads).toBe(true);
    });

    it('should return moderation capabilities', () => {
      const metadata = adapter.getMetadata();

      expect(metadata.capabilities.moderation.ban).toBe(false);
      expect(metadata.capabilities.moderation.timeout).toBe(false);
      expect(metadata.capabilities.moderation.delete).toBe(true);
    });
  });
});

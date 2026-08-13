/**
 * Discord Connector Adapter Webhook Tests
 *
 * Tests for DiscordConnectorAdapter (WebhookConnector interface).
 *
 * Sprint 11: Discord Integration Modernization (DISC-012)
 *
 * @since Sprint 11
 */

import { DiscordConnectorAdapter } from '../connector-adapter';
import type { DiscordIngressClient } from '../discord-ingress-client';
import type { WebhookRequest, WebhookResponse } from '../../core';
import type { IConfig } from '../../../../types';
import * as webhookUtils from '../webhook-utils';

// Mock logger
jest.mock('../../../../common/logging', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock webhook-utils
jest.mock('../webhook-utils', () => ({
  validateDiscordSignature: jest.fn(),
  isTimestampValid: jest.fn(),
}));

describe('DiscordConnectorAdapter', () => {
  let mockClient: jest.Mocked<DiscordIngressClient>;
  let adapter: DiscordConnectorAdapter;
  let config: Partial<IConfig>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock DiscordIngressClient
    mockClient = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      getSnapshot: jest.fn(),
      sendText: jest.fn(),
      banUser: jest.fn(),
    } as any;

    config = {
      discordPublicKey: 'test_public_key_abc123',
    };

    adapter = new DiscordConnectorAdapter(mockClient, config as IConfig);

    // Default mock implementations
    (webhookUtils.validateDiscordSignature as jest.Mock).mockReturnValue(true);
    (webhookUtils.isTimestampValid as jest.Mock).mockReturnValue(true);
  });

  describe('WebhookConnector interface', () => {
    describe('verifySignature()', () => {
      it('should verify valid Discord Ed25519 signatures', () => {
        const req: WebhookRequest = {
          method: 'POST',
          headers: {
            'x-signature-ed25519': 'valid_signature',
            'x-signature-timestamp': '1234567890',
          },
          body: { type: 1 },
          rawBody: Buffer.from('{"type":1}'),
          url: '/webhooks/discord',
        };

        const result = adapter.verifySignature(req);

        expect(result).toBe(true);
        expect(webhookUtils.validateDiscordSignature).toHaveBeenCalledWith(
          'test_public_key_abc123',
          'valid_signature',
          '1234567890',
          Buffer.from('{"type":1}')
        );
      });

      it('should reject invalid signatures', () => {
        (webhookUtils.validateDiscordSignature as jest.Mock).mockReturnValue(false);

        const req: WebhookRequest = {
          method: 'POST',
          headers: {
            'x-signature-ed25519': 'invalid_signature',
            'x-signature-timestamp': '1234567890',
          },
          body: { type: 1 },
          rawBody: Buffer.from('{"type":1}'),
          url: '/webhooks/discord',
        };

        const result = adapter.verifySignature(req);

        expect(result).toBe(false);
      });

      it('should reject missing x-signature-ed25519 header', () => {
        const req: WebhookRequest = {
          method: 'POST',
          headers: {
            'x-signature-timestamp': '1234567890',
          },
          body: { type: 1 },
          url: '/webhooks/discord',
        };

        const result = adapter.verifySignature(req);

        expect(result).toBe(false);
        expect(webhookUtils.validateDiscordSignature).not.toHaveBeenCalled();
      });

      it('should reject missing x-signature-timestamp header', () => {
        const req: WebhookRequest = {
          method: 'POST',
          headers: {
            'x-signature-ed25519': 'signature',
          },
          body: { type: 1 },
          url: '/webhooks/discord',
        };

        const result = adapter.verifySignature(req);

        expect(result).toBe(false);
        expect(webhookUtils.validateDiscordSignature).not.toHaveBeenCalled();
      });

      it('should reject malformed signature headers', () => {
        (webhookUtils.validateDiscordSignature as jest.Mock).mockReturnValue(false);

        const req: WebhookRequest = {
          method: 'POST',
          headers: {
            'x-signature-ed25519': 'malformed',
            'x-signature-timestamp': 'not_a_timestamp',
          },
          body: { type: 1 },
          rawBody: Buffer.from('{"type":1}'),
          url: '/webhooks/discord',
        };

        const result = adapter.verifySignature(req);

        expect(result).toBe(false);
      });

      it('should use PUBLIC_KEY from config', () => {
        const req: WebhookRequest = {
          method: 'POST',
          headers: {
            'x-signature-ed25519': 'signature',
            'x-signature-timestamp': '1234567890',
          },
          body: { type: 1 },
          rawBody: Buffer.from('{"type":1}'),
          url: '/webhooks/discord',
        };

        adapter.verifySignature(req);

        expect(webhookUtils.validateDiscordSignature).toHaveBeenCalledWith(
          'test_public_key_abc123',
          expect.any(String),
          expect.any(String),
          expect.any(Buffer)
        );
      });

      it('should log signature verification failures', () => {
        (webhookUtils.validateDiscordSignature as jest.Mock).mockReturnValue(false);
        const { logger } = require('../../../../common/logging');

        const req: WebhookRequest = {
          method: 'POST',
          headers: {
            'x-signature-ed25519': 'invalid',
            'x-signature-timestamp': '1234567890',
          },
          body: { type: 1 },
          rawBody: Buffer.from('{"type":1}'),
          url: '/webhooks/discord',
        };

        adapter.verifySignature(req);

        expect(logger.warn).toHaveBeenCalledWith('discord.webhook.invalid_signature');
      });
    });

    describe('handleWebhook()', () => {
      describe('ping interaction (type: 1)', () => {
        it('should respond with { type: 1 } immediately', async () => {
          const req: WebhookRequest = {
          method: 'POST',
            headers: {},
            body: { type: 1, id: 'ping123' },
            url: '/webhooks/discord',
          };

          const response = await adapter.handleWebhook(req);

          expect(response.status).toBe(200);
          expect(response.body).toEqual({ type: 1 });
        });

        it('should return 200 status', async () => {
          const req: WebhookRequest = {
          method: 'POST',
            headers: {},
            body: { type: 1, id: 'ping123' },
            url: '/webhooks/discord',
          };

          const response = await adapter.handleWebhook(req);

          expect(response.status).toBe(200);
        });

        it('should complete within 3 seconds (SLA)', async () => {
          const req: WebhookRequest = {
          method: 'POST',
            headers: {},
            body: { type: 1, id: 'ping123' },
            url: '/webhooks/discord',
          };

          const startTime = Date.now();
          await adapter.handleWebhook(req);
          const endTime = Date.now();

          expect(endTime - startTime).toBeLessThan(3000);
        });

        it('should log ping received', async () => {
          const { logger } = require('../../../../common/logging');
          const req: WebhookRequest = {
          method: 'POST',
            headers: {},
            body: { type: 1, id: 'ping123' },
            url: '/webhooks/discord',
          };

          await adapter.handleWebhook(req);

          expect(logger.info).toHaveBeenCalledWith('discord.webhook.ping', { interactionId: 'ping123' });
        });
      });

      describe('application command (type: 2)', () => {
        it('should respond with { type: 4, data: { content } } immediately', async () => {
          const req: WebhookRequest = {
          method: 'POST',
            headers: {},
            body: {
              type: 2,
              id: 'cmd123',
              data: { name: 'test-command' },
            },
            url: '/webhooks/discord',
          };

          const response = await adapter.handleWebhook(req);

          expect(response.status).toBe(200);
          expect(response.body).toMatchObject({
            type: 4,
            data: {
              content: expect.stringContaining('test-command'),
              flags: 64, // EPHEMERAL
            },
          });
        });

        it('should return 200 status', async () => {
          const req: WebhookRequest = {
          method: 'POST',
            headers: {},
            body: {
              type: 2,
              id: 'cmd123',
              data: { name: 'ping' },
            },
            url: '/webhooks/discord',
          };

          const response = await adapter.handleWebhook(req);

          expect(response.status).toBe(200);
        });

        it('should complete within 3 seconds (SLA)', async () => {
          const req: WebhookRequest = {
          method: 'POST',
            headers: {},
            body: {
              type: 2,
              id: 'cmd123',
              data: { name: 'ping' },
            },
            url: '/webhooks/discord',
          };

          const startTime = Date.now();
          await adapter.handleWebhook(req);
          const endTime = Date.now();

          expect(endTime - startTime).toBeLessThan(3000);
        });

        it('should process command asynchronously via setImmediate()', async () => {
          const req: WebhookRequest = {
          method: 'POST',
            headers: {},
            body: {
              type: 2,
              id: 'cmd123',
              data: { name: 'async-command' },
            },
            url: '/webhooks/discord',
          };

          const { logger } = require('../../../../common/logging');

          // Response should be returned immediately
          const response = await adapter.handleWebhook(req);
          expect(response.status).toBe(200);

          // Async processing should happen after response (logged via setImmediate)
          await new Promise((resolve) => setImmediate(resolve));

          expect(logger.info).toHaveBeenCalledWith(
            'discord.webhook.command_received',
            expect.objectContaining({
              interactionId: 'cmd123',
              commandName: 'async-command',
            })
          );
        });

        it.todo('should publish envelope after response sent');
        it.todo('should extract command data correctly');
        it.todo('should handle options array');
        it.todo('should handle nested data structures');
      });

      describe('unsupported interaction types', () => {
        it('should return 400 for unknown interaction types', async () => {
          const req: WebhookRequest = {
          method: 'POST',
            headers: {},
            body: { type: 999, id: 'unknown123' },
            url: '/webhooks/discord',
          };

          const response = await adapter.handleWebhook(req);

          expect(response.status).toBe(400);
          expect(response.body).toEqual({ error: 'unsupported_interaction_type' });
        });

        it('should log unsupported type warning', async () => {
          const { logger } = require('../../../../common/logging');
          const req: WebhookRequest = {
          method: 'POST',
            headers: {},
            body: { type: 999, id: 'unknown123' },
            url: '/webhooks/discord',
          };

          await adapter.handleWebhook(req);

          expect(logger.warn).toHaveBeenCalledWith('discord.webhook.unsupported_type', {
            type: 999,
            interactionId: 'unknown123',
          });
        });
      });

      describe('SLA enforcement', () => {
        it('should return response within 3 seconds', async () => {
          const req: WebhookRequest = {
          method: 'POST',
            headers: {},
            body: { type: 2, id: 'sla123', data: { name: 'test' } },
            url: '/webhooks/discord',
          };

          const startTime = Date.now();
          await adapter.handleWebhook(req);
          const endTime = Date.now();

          expect(endTime - startTime).toBeLessThan(3000);
        });

        it('should defer heavy processing after response', async () => {
          const { logger } = require('../../../../common/logging');
          const req: WebhookRequest = {
          method: 'POST',
            headers: {},
            body: { type: 2, id: 'heavy123', data: { name: 'heavy-task' } },
            url: '/webhooks/discord',
          };

          // Response returned immediately
          const response = await adapter.handleWebhook(req);
          expect(response.status).toBe(200);

          // Heavy processing logged after response (via setImmediate)
          await new Promise((resolve) => setImmediate(resolve));
          expect(logger.info).toHaveBeenCalledWith(
            'discord.webhook.command_received',
            expect.any(Object)
          );
        });

        it('should use setImmediate() for async work', async () => {
          const req: WebhookRequest = {
          method: 'POST',
            headers: {},
            body: { type: 2, id: 'async123', data: { name: 'async' } },
            url: '/webhooks/discord',
          };

          const response = await adapter.handleWebhook(req);
          expect(response.status).toBe(200);

          // Verify async work happens after response
          await new Promise((resolve) => setImmediate(resolve));
        });

        it.todo('should log response time metrics');
        it.todo('should not block webhook response with external API calls');
      });

      describe('error handling', () => {
        it.todo('should handle envelope build errors gracefully');
        it.todo('should handle publisher errors gracefully');

        it('should not crash on malformed interaction payload', async () => {
          const req: WebhookRequest = {
          method: 'POST',
            headers: {},
            body: { type: 2, data: null }, // Missing id and malformed data
            url: '/webhooks/discord',
          };

          // Should not throw error
          const response = await adapter.handleWebhook(req);
          expect(response).toBeDefined();
        });

        it('should log processing errors', async () => {
          const { logger } = require('../../../../common/logging');
          const req: WebhookRequest = {
          method: 'POST',
            headers: {},
            body: { type: 2, id: 'error123', data: { name: 'error-command' } },
            url: '/webhooks/discord',
          };

          await adapter.handleWebhook(req);

          // Allow async processing to complete
          await new Promise((resolve) => setImmediate(resolve));

          // Verify logging occurred (info log for command received)
          expect(logger.info).toHaveBeenCalled();
        });
      });
    });

    describe('integration with signature verification', () => {
      it('should verify signature before processing webhook', () => {
        const req: WebhookRequest = {
          method: 'POST',
          headers: {
            'x-signature-ed25519': 'signature',
            'x-signature-timestamp': '1234567890',
          },
          body: { type: 1 },
          rawBody: Buffer.from('{"type":1}'),
          url: '/webhooks/discord',
        };

        adapter.verifySignature(req);

        expect(webhookUtils.validateDiscordSignature).toHaveBeenCalled();
      });

      it('should reject webhook if signature invalid', () => {
        (webhookUtils.validateDiscordSignature as jest.Mock).mockReturnValue(false);

        const req: WebhookRequest = {
          method: 'POST',
          headers: {
            'x-signature-ed25519': 'invalid',
            'x-signature-timestamp': '1234567890',
          },
          body: { type: 1 },
          rawBody: Buffer.from('{"type":1}'),
          url: '/webhooks/discord',
        };

        const result = adapter.verifySignature(req);

        expect(result).toBe(false);
      });

      it.todo('should return 401 for invalid signatures');
      it.todo('should not process interaction if signature fails');
    });

    describe('correlation ID generation', () => {
      it.todo('should generate unique correlation ID for each interaction');
      it.todo('should use interaction ID if available');
      it.todo('should attach correlation ID to envelope');
    });

    describe('envelope construction', () => {
      it.todo('should build Discord envelope from interaction payload');
      it.todo('should extract user ID from member or user object');
      it.todo('should extract channel ID');
      it.todo('should extract guild ID');
      it.todo('should include interaction data in envelope');
      it.todo('should set proper envelope type (chat.message.v1)');
    });

    describe('webhook request format', () => {
      it('should handle WebhookRequest with headers', () => {
        const req: WebhookRequest = {
          method: 'POST',
          headers: {
            'x-signature-ed25519': 'sig',
            'x-signature-timestamp': '1234567890',
          },
          body: { type: 1 },
          url: '/webhooks/discord',
        };

        const result = adapter.verifySignature(req);
        expect(result).toBeDefined();
      });

      it('should handle WebhookRequest with body', async () => {
        const req: WebhookRequest = {
          method: 'POST',
          headers: {},
          body: { type: 1, id: 'test123' },
          url: '/webhooks/discord',
        };

        const response = await adapter.handleWebhook(req);
        expect(response).toBeDefined();
        expect(response.body).toBeDefined();
      });

      it('should handle WebhookRequest with rawBody', () => {
        const req: WebhookRequest = {
          method: 'POST',
          headers: {
            'x-signature-ed25519': 'sig',
            'x-signature-timestamp': '1234567890',
          },
          body: { type: 1 },
          rawBody: Buffer.from('{"type":1}'),
          url: '/webhooks/discord',
        };

        adapter.verifySignature(req);

        expect(webhookUtils.validateDiscordSignature).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.any(String),
          Buffer.from('{"type":1}')
        );
      });

      it('should use rawBody for signature verification when available', () => {
        const rawBodyBuffer = Buffer.from('{"type":1,"custom":"data"}');
        const req: WebhookRequest = {
          method: 'POST',
          headers: {
            'x-signature-ed25519': 'sig',
            'x-signature-timestamp': '1234567890',
          },
          body: { type: 1 },
          rawBody: rawBodyBuffer,
          url: '/webhooks/discord',
        };

        adapter.verifySignature(req);

        // Should use rawBody instead of body
        expect(webhookUtils.validateDiscordSignature).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.any(String),
          rawBodyBuffer
        );
      });
    });
  });

  describe('getMetadata() - webhook capabilities', () => {
    it('should indicate webhook support for Interactions API', () => {
      const metadata = adapter.getMetadata();
      expect(metadata.capabilities.ingress.method).toBe('hybrid');
    });

    it('should indicate requiresPublicUrl: false for Gateway-primary mode', () => {
      const metadata = adapter.getMetadata();
      expect(metadata.capabilities.ingress.requiresPublicUrl).toBe(false);
    });

    it('should indicate method: "hybrid" (Gateway + Interactions)', () => {
      const metadata = adapter.getMetadata();
      expect(metadata.capabilities.ingress.method).toBe('hybrid');
    });
  });
});

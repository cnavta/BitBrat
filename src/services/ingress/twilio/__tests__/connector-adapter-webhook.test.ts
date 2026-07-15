/**
 * Regression tests for TwilioConnectorAdapter webhook functionality
 *
 * Validates WebhookConnector interface implementation:
 * - Signature verification (valid/invalid)
 * - Webhook event processing
 * - Bot auto-join logic
 * - Error handling
 *
 * @since Sprint 342 - IEF-009
 */

import { TwilioConnectorAdapter } from '../connector-adapter';
import { TwilioIngressClient } from '../twilio-ingress-client';
import { validateTwilioSignature } from '../webhook-utils';
import type { WebhookRequest } from '../../core';
import type { IConfig } from '../../../../types';

// Mock dependencies
jest.mock('../webhook-utils');
jest.mock('twilio', () => {
  return jest.fn(() => ({
    conversations: {
      v1: {
        conversations: jest.fn((sid: string) => ({
          participants: {
            create: jest.fn((data: any) => Promise.resolve({ sid: 'PA123', identity: data.identity }))
          }
        }))
      }
    }
  }));
});

describe('TwilioConnectorAdapter - WebhookConnector', () => {
  let adapter: TwilioConnectorAdapter;
  let mockClient: jest.Mocked<TwilioIngressClient>;
  let mockConfig: IConfig;

  beforeEach(() => {
    // Create mock Twilio client
    mockClient = {
      start: jest.fn(),
      stop: jest.fn(),
      getSnapshot: jest.fn().mockReturnValue({
        state: 'CONNECTED',
        identity: 'test-bot',
        counters: { received: 0, published: 0, failed: 0 }
      }),
      sendText: jest.fn()
    } as any;

    // Create mock config
    mockConfig = {
      twilioAccountSid: 'AC123',
      twilioAuthToken: 'test-auth-token',
      twilioIdentity: 'test-bot',
      twilioEnabled: true
    } as any;

    // Create adapter with config
    adapter = new TwilioConnectorAdapter(mockClient, mockConfig);

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('verifySignature()', () => {
    it('should verify valid Twilio signature', () => {
      const mockRequest: WebhookRequest = {
        headers: {
          'x-twilio-signature': 'valid-signature',
          'host': 'example.com',
          'x-forwarded-proto': 'https'
        },
        body: { EventType: 'onConversationAdded', ConversationSid: 'CH123' },
        url: '/webhooks/twilio',
        method: 'POST'
      };

      (validateTwilioSignature as jest.Mock).mockReturnValue(true);

      const result = adapter.verifySignature(mockRequest);

      expect(result).toBe(true);
      expect(validateTwilioSignature).toHaveBeenCalledWith(
        'test-auth-token',
        'valid-signature',
        'https://example.com/webhooks/twilio',
        mockRequest.body
      );
    });

    it('should reject invalid Twilio signature', () => {
      const mockRequest: WebhookRequest = {
        headers: {
          'x-twilio-signature': 'invalid-signature',
          'host': 'example.com'
        },
        body: { EventType: 'onConversationAdded' },
        url: '/webhooks/twilio',
        method: 'POST'
      };

      (validateTwilioSignature as jest.Mock).mockReturnValue(false);

      const result = adapter.verifySignature(mockRequest);

      expect(result).toBe(false);
    });

    it('should return false when signature header is missing', () => {
      const mockRequest: WebhookRequest = {
        headers: {
          'host': 'example.com'
        },
        body: {},
        url: '/webhooks/twilio',
        method: 'POST'
      };

      const result = adapter.verifySignature(mockRequest);

      expect(result).toBe(false);
      expect(validateTwilioSignature).not.toHaveBeenCalled();
    });

    it('should return false when config auth token is missing', () => {
      const adapterNoConfig = new TwilioConnectorAdapter(mockClient);

      const mockRequest: WebhookRequest = {
        headers: {
          'x-twilio-signature': 'valid-signature',
          'host': 'example.com'
        },
        body: {},
        url: '/webhooks/twilio',
        method: 'POST'
      };

      const result = adapterNoConfig.verifySignature(mockRequest);

      expect(result).toBe(false);
    });

    it('should reconstruct URL with x-forwarded-proto for Cloud Run', () => {
      const mockRequest: WebhookRequest = {
        headers: {
          'x-twilio-signature': 'sig',
          'host': 'myapp.run.app',
          'x-forwarded-proto': 'https'
        },
        body: {},
        url: '/webhooks/twilio?param=value',
        method: 'POST'
      };

      (validateTwilioSignature as jest.Mock).mockReturnValue(true);

      adapter.verifySignature(mockRequest);

      expect(validateTwilioSignature).toHaveBeenCalledWith(
        'test-auth-token',
        'sig',
        'https://myapp.run.app/webhooks/twilio?param=value',
        mockRequest.body
      );
    });
  });

  describe('handleWebhook()', () => {
    it('should handle onConversationAdded event and inject bot', async () => {
      const mockRequest: WebhookRequest = {
        headers: {},
        body: {
          EventType: 'onConversationAdded',
          ConversationSid: 'CH123'
        },
        url: '/webhooks/twilio',
        method: 'POST'
      };

      const response = await adapter.handleWebhook(mockRequest);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });

      // Verify twilio SDK was called to add participant
      const twilio = require('twilio');
      expect(twilio).toHaveBeenCalledWith('AC123', 'test-auth-token');
    });

    it('should handle onMessageAdded event and inject bot', async () => {
      const mockRequest: WebhookRequest = {
        headers: {},
        body: {
          EventType: 'onMessageAdded',
          ConversationSid: 'CH456'
        },
        url: '/webhooks/twilio',
        method: 'POST'
      };

      const response = await adapter.handleWebhook(mockRequest);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });

    it('should ignore other event types', async () => {
      const mockRequest: WebhookRequest = {
        headers: {},
        body: {
          EventType: 'onConversationRemoved',
          ConversationSid: 'CH789'
        },
        url: '/webhooks/twilio',
        method: 'POST'
      };

      const response = await adapter.handleWebhook(mockRequest);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });

      // Twilio SDK should not be called for non-target events
      const twilio = require('twilio');
      expect(twilio).not.toHaveBeenCalled();
    });

    it('should return 500 when config credentials are missing', async () => {
      const adapterNoConfig = new TwilioConnectorAdapter(mockClient, {} as any);

      const mockRequest: WebhookRequest = {
        headers: {},
        body: {
          EventType: 'onConversationAdded',
          ConversationSid: 'CH123'
        },
        url: '/webhooks/twilio',
        method: 'POST'
      };

      const response = await adapterNoConfig.handleWebhook(mockRequest);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'misconfigured' });
    });

    it('should handle "already exists" error gracefully (code 50433)', async () => {
      const twilioMock = require('twilio');
      twilioMock.mockImplementationOnce(() => ({
        conversations: {
          v1: {
            conversations: () => ({
              participants: {
                create: jest.fn().mockRejectedValue({ code: 50433, message: 'Participant already exists' })
              }
            })
          }
        }
      }));

      const mockRequest: WebhookRequest = {
        headers: {},
        body: {
          EventType: 'onConversationAdded',
          ConversationSid: 'CH123'
        },
        url: '/webhooks/twilio',
        method: 'POST'
      };

      const response = await adapter.handleWebhook(mockRequest);

      // Should still return 200 (error is expected/handled)
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });

    it('should handle "already exists" error gracefully (status 409)', async () => {
      const twilioMock = require('twilio');
      twilioMock.mockImplementationOnce(() => ({
        conversations: {
          v1: {
            conversations: () => ({
              participants: {
                create: jest.fn().mockRejectedValue({ status: 409, message: 'Conflict' })
              }
            })
          }
        }
      }));

      const mockRequest: WebhookRequest = {
        headers: {},
        body: {
          EventType: 'onMessageAdded',
          ConversationSid: 'CH456'
        },
        url: '/webhooks/twilio',
        method: 'POST'
      };

      const response = await adapter.handleWebhook(mockRequest);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });
  });

  describe('getMetadata()', () => {
    it('should return Twilio connector metadata', () => {
      const metadata = adapter.getMetadata();

      expect(metadata).toEqual({
        platform: 'twilio',
        version: '1.0.0',
        authMethod: 'api_key',
        capabilities: {
          ingress: {
            method: 'hybrid',
            realtime: true,
            requiresWebhook: true,
            requiresPublicUrl: true
          },
          egress: {
            chat: true,
            dm: true,
            reactions: false,
            threads: false
          },
          moderation: {
            ban: false,
            timeout: false,
            delete: false
          }
        }
      });
    });

    it('should indicate hybrid ingress method (WebSocket + Webhook)', () => {
      const metadata = adapter.getMetadata();

      expect(metadata.capabilities.ingress.method).toBe('hybrid');
      expect(metadata.capabilities.ingress.realtime).toBe(true);
      expect(metadata.capabilities.ingress.requiresWebhook).toBe(true);
    });
  });

  describe('IngressConnector methods (backward compatibility)', () => {
    it('should preserve start() method', async () => {
      await adapter.start();
      expect(mockClient.start).toHaveBeenCalledTimes(1);
    });

    it('should preserve stop() method', async () => {
      await adapter.stop();
      expect(mockClient.stop).toHaveBeenCalledTimes(1);
    });

    it('should preserve getSnapshot() method', () => {
      const snapshot = adapter.getSnapshot();
      expect(snapshot.state).toBe('CONNECTED');
      expect(snapshot.id).toBe('test-bot');
    });

    it('should preserve sendText() method', async () => {
      await adapter.sendText('Hello', 'CH123');
      expect(mockClient.sendText).toHaveBeenCalledWith('Hello', 'CH123');
    });
  });
});

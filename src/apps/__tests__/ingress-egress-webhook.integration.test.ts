/**
 * Integration tests for generic webhook routing
 *
 * Validates end-to-end webhook request flow:
 * - Generic POST /webhooks/:platform route
 * - ConnectorManager platform lookup
 * - WebhookHandler delegation
 * - Signature verification
 * - Event processing
 * - Error handling
 *
 * @since Sprint 342 - IEF-006
 */

import request from 'supertest';
import express, { Express, Request, Response } from 'express';
import { ConnectorManager, WebhookHandler, WebhookConnector, WebhookRequest, WebhookResponse, ConnectorMetadata, IngressConnector, ConnectorSnapshot } from '../../services/ingress/core';
import crypto from 'crypto';

// Mock connector for testing
class MockPlatformConnector implements IngressConnector, WebhookConnector {
  private webhookHandler: ((req: WebhookRequest) => Promise<WebhookResponse>) | null = null;
  private signatureValidator: ((req: WebhookRequest) => boolean) | null = null;

  // IngressConnector methods
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  getSnapshot(): ConnectorSnapshot {
    return {
      state: 'CONNECTED',
      id: 'mock-bot',
      displayName: 'Mock Bot',
      lastError: null
    };
  }
  async sendText(text: string, target?: string): Promise<void> {}

  // WebhookConnector methods
  verifySignature(req: WebhookRequest): boolean {
    if (this.signatureValidator) {
      return this.signatureValidator(req);
    }
    return true;  // Default: accept all
  }

  async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
    if (this.webhookHandler) {
      return this.webhookHandler(req);
    }
    return { status: 200, body: { ok: true } };  // Default response
  }

  getMetadata(): ConnectorMetadata {
    return {
      platform: 'mock-platform',
      version: '1.0.0',
      authMethod: 'api_key',
      capabilities: {
        ingress: {
          method: 'webhook',
          realtime: false,
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
    };
  }

  // Test helpers
  setWebhookHandler(handler: (req: WebhookRequest) => Promise<WebhookResponse>) {
    this.webhookHandler = handler;
  }

  setSignatureValidator(validator: (req: WebhookRequest) => boolean) {
    this.signatureValidator = validator;
  }
}

// Minimal Express app mimicking ingress-egress-service webhook route
function createTestApp(manager: ConnectorManager): Express {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Generic webhook routing (Sprint 342 - IEF-005)
  app.post('/webhooks/:platform', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const platform = req.params.platform?.toLowerCase();
    const correlationId = crypto.randomUUID();

    if (!platform) {
      res.status(400).json({ error: 'missing_platform' });
      return;
    }

    // Lookup connector from ConnectorManager
    const connector = manager.getConnectorByPlatform(platform);
    if (!connector) {
      res.status(404).json({ error: 'platform_not_found', platform });
      return;
    }

    // Check if connector implements WebhookConnector interface
    const webhookConnector = connector as unknown as WebhookConnector;
    if (typeof (connector as any).handleWebhook !== 'function' ||
        typeof (connector as any).verifySignature !== 'function') {
      res.status(501).json({ error: 'connector_does_not_support_webhooks', platform });
      return;
    }

    // Delegate to WebhookHandler
    const handler = new WebhookHandler(webhookConnector, console as any);
    try {
      await handler.handle(req, res);

      const duration = Date.now() - startTime;
      console.log(`webhook.generic.handled: ${platform} in ${duration}ms`);
    } catch (err: any) {
      const duration = Date.now() - startTime;
      console.error(`webhook.generic.error: ${platform} - ${err.message} (${duration}ms)`);

      if (!res.headersSent) {
        res.status(500).json({ error: 'internal_error', correlationId });
      }
    }
  });

  return app;
}

describe('Ingress-Egress Service - Generic Webhook Integration', () => {
  let app: Express;
  let manager: ConnectorManager;
  let mockConnector: MockPlatformConnector;

  beforeEach(() => {
    manager = new ConnectorManager();
    mockConnector = new MockPlatformConnector();
    manager.register('mock-platform', mockConnector);
    app = createTestApp(manager);
  });

  describe('POST /webhooks/:platform', () => {
    it('should route webhook to correct platform connector', async () => {
      let receivedRequest: WebhookRequest | null = null;

      mockConnector.setWebhookHandler(async (req) => {
        receivedRequest = req;
        return { status: 200, body: { ok: true } };
      });

      const response = await request(app)
        .post('/webhooks/mock-platform')
        .send({ event_type: 'test.event', event_id: '123' })
        .set('Content-Type', 'application/json')
        .expect(200);

      // WebhookHandler always returns { received: true, correlationId } for SLA compliance
      expect(response.body).toHaveProperty('received', true);
      expect(response.body).toHaveProperty('correlationId');

      // Verify connector received the request
      expect(receivedRequest).not.toBeNull();
      expect(receivedRequest).toBeDefined();
      expect(receivedRequest!.body).toEqual({ event_type: 'test.event', event_id: '123' });
    });

    it('should return 404 when platform not found', async () => {
      const response = await request(app)
        .post('/webhooks/unknown-platform')
        .send({ event_type: 'test.event' })
        .expect(404);

      expect(response.body).toEqual({
        error: 'platform_not_found',
        platform: 'unknown-platform'
      });
    });

    it('should return 404 when platform parameter is missing', async () => {
      const response = await request(app)
        .post('/webhooks/')
        .send({ event_type: 'test.event' })
        .expect(404);  // Express 404 for route not found (no /webhooks/ route, only /webhooks/:platform)
    });

    it('should validate webhook signature before processing', async () => {
      let signatureValidationCalled = false;
      let webhookHandlerCalled = false;

      mockConnector.setSignatureValidator((req) => {
        signatureValidationCalled = true;
        return req.headers['x-signature'] === 'valid-signature';
      });

      mockConnector.setWebhookHandler(async (req) => {
        webhookHandlerCalled = true;
        return { status: 200, body: { ok: true } };
      });

      // Valid signature
      await request(app)
        .post('/webhooks/mock-platform')
        .set('x-signature', 'valid-signature')
        .send({ event_type: 'test.event' })
        .expect(200);

      expect(signatureValidationCalled).toBe(true);
      expect(webhookHandlerCalled).toBe(true);
    });

    it('should reject webhook with invalid signature', async () => {
      let webhookHandlerCalled = false;

      mockConnector.setSignatureValidator((req) => {
        return req.headers['x-signature'] === 'valid-signature';
      });

      mockConnector.setWebhookHandler(async (req) => {
        webhookHandlerCalled = true;
        return { status: 200, body: { ok: true } };
      });

      // Invalid signature
      const response = await request(app)
        .post('/webhooks/mock-platform')
        .set('x-signature', 'invalid-signature')
        .send({ event_type: 'test.event' })
        .expect(403);

      // WebhookHandler returns JSON error for invalid signature
      expect(response.body).toHaveProperty('error', 'invalid_signature');
      expect(webhookHandlerCalled).toBe(false);
    });

    it('should reject webhook connector without required methods', async () => {
      // Register connector that doesn't implement WebhookConnector
      const badConnector = {
        start: async () => {},
        stop: async () => {},
        getSnapshot: () => ({ state: 'CONNECTED', id: 'bad' }),
        sendText: async () => {}
      } as IngressConnector;

      manager.register('bad-platform', badConnector);

      const response = await request(app)
        .post('/webhooks/bad-platform')
        .send({ event_type: 'test.event' })
        .expect(501);

      expect(response.body).toEqual({
        error: 'connector_does_not_support_webhooks',
        platform: 'bad-platform'
      });
    });

    it('should handle custom webhook responses from connector', async () => {
      // Note: WebhookHandler ALWAYS returns 200 with { received: true, correlationId }
      // Custom responses from connector are processed async via setImmediate()
      mockConnector.setWebhookHandler(async (req) => {
        return {
          status: 202,
          body: { message: 'Accepted', event_id: req.body.event_id },
          headers: { 'x-custom-header': 'custom-value' }
        };
      });

      const response = await request(app)
        .post('/webhooks/mock-platform')
        .send({ event_id: '456' })
        .expect(200);  // WebhookHandler always returns 200

      // WebhookHandler standardizes response for SLA compliance
      expect(response.body).toHaveProperty('received', true);
      expect(response.body).toHaveProperty('correlationId');
    });

    it('should handle connector errors gracefully', async () => {
      // WebhookHandler processes errors in setImmediate(), AFTER returning 200 OK
      // This ensures SLA compliance even if connector throws errors
      mockConnector.setWebhookHandler(async (req) => {
        throw new Error('Internal connector error');
      });

      const response = await request(app)
        .post('/webhooks/mock-platform')
        .send({ event_type: 'test.event' })
        .expect(200);  // Still returns 200 for SLA compliance

      // Error is logged but doesn't affect webhook response
      expect(response.body).toHaveProperty('received', true);
      expect(response.body).toHaveProperty('correlationId');
    });

    it('should reconstruct full webhook URL for signature verification', async () => {
      let receivedUrl: string | null = null;

      mockConnector.setSignatureValidator((req) => {
        receivedUrl = req.url;
        return true;
      });

      await request(app)
        .post('/webhooks/mock-platform?param1=value1&param2=value2')
        .set('host', 'example.com')
        .set('x-forwarded-proto', 'https')
        .send({ event_type: 'test.event' })
        .expect(200);

      expect(receivedUrl).toBe('/webhooks/mock-platform?param1=value1&param2=value2');
    });

    it('should preserve request headers for connector', async () => {
      let receivedHeaders: Record<string, any> | null = null;

      mockConnector.setWebhookHandler(async (req) => {
        receivedHeaders = req.headers;
        return { status: 200, body: { ok: true } };
      });

      await request(app)
        .post('/webhooks/mock-platform')
        .set('x-custom-header', 'custom-value')
        .set('user-agent', 'Test-Agent/1.0')
        .send({ event_type: 'test.event' })
        .expect(200);

      expect(receivedHeaders).not.toBeNull();
      expect(receivedHeaders!['x-custom-header']).toBe('custom-value');
      expect(receivedHeaders!['user-agent']).toBe('Test-Agent/1.0');
    });

    it('should handle form-urlencoded webhooks', async () => {
      let receivedBody: Record<string, any> | null = null;

      mockConnector.setWebhookHandler(async (req) => {
        receivedBody = req.body;
        return { status: 200, body: { ok: true } };
      });

      await request(app)
        .post('/webhooks/mock-platform')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('event_type=form.event&event_id=789')
        .expect(200);

      expect(receivedBody).not.toBeNull();
      expect(receivedBody!).toEqual({ event_type: 'form.event', event_id: '789' });
    });

    it('should respond within 3 seconds for SLA compliance', async () => {
      mockConnector.setWebhookHandler(async (req) => {
        // Simulate async processing after response
        setImmediate(async () => {
          // Heavy processing happens after 200 OK
          await new Promise(resolve => setTimeout(resolve, 100));
        });

        return { status: 200, body: { ok: true } };
      });

      const startTime = Date.now();

      await request(app)
        .post('/webhooks/mock-platform')
        .send({ event_type: 'test.event' })
        .expect(200);

      const duration = Date.now() - startTime;

      // Should respond immediately (< 100ms), well under 3-second SLA
      expect(duration).toBeLessThan(3000);
      expect(duration).toBeLessThan(1000);  // Realistically < 1 second
    });

    it('should support multiple platforms simultaneously', async () => {
      // Register second platform
      const mockConnector2 = new MockPlatformConnector();
      let platform1Called = false;
      let platform2Called = false;

      mockConnector.setWebhookHandler(async (req) => {
        platform1Called = true;
        return { status: 200, body: { platform: 1 } };
      });

      mockConnector2.setWebhookHandler(async (req) => {
        platform2Called = true;
        return { status: 200, body: { platform: 2 } };
      });

      manager.register('platform-2', mockConnector2);

      // Call platform 1
      const response1 = await request(app)
        .post('/webhooks/mock-platform')
        .send({ event_type: 'test' })
        .expect(200);

      // Call platform 2
      const response2 = await request(app)
        .post('/webhooks/platform-2')
        .send({ event_type: 'test' })
        .expect(200);

      expect(platform1Called).toBe(true);
      expect(platform2Called).toBe(true);
      // WebhookHandler wraps response bodies with correlationId and received
      expect(response1.body).toHaveProperty('correlationId');
      expect(response1.body).toHaveProperty('received');
      expect(response2.body).toHaveProperty('correlationId');
      expect(response2.body).toHaveProperty('received');
    });
  });

  describe('ConnectorManager Integration', () => {
    it('should lookup connector by platform name', () => {
      const connector = manager.getConnectorByPlatform('mock-platform');
      expect(connector).toBe(mockConnector);
    });

    it('should return null/undefined for unknown platform', () => {
      const connector = manager.getConnectorByPlatform('unknown');
      expect(connector).toBeFalsy();  // null or undefined both acceptable
    });

    it('should support case-insensitive platform lookup', async () => {
      await request(app)
        .post('/webhooks/MOCK-PLATFORM')
        .send({ event_type: 'test' })
        .expect(200);

      await request(app)
        .post('/webhooks/Mock-Platform')
        .send({ event_type: 'test' })
        .expect(200);
    });
  });

  describe('WebhookHandler Integration', () => {
    it('should delegate signature verification to connector', async () => {
      let verifySignatureCalled = false;

      mockConnector.setSignatureValidator((req) => {
        verifySignatureCalled = true;
        return true;
      });

      await request(app)
        .post('/webhooks/mock-platform')
        .send({ event_type: 'test' })
        .expect(200);

      expect(verifySignatureCalled).toBe(true);
    });

    it('should delegate event handling to connector', async () => {
      let handleWebhookCalled = false;

      mockConnector.setWebhookHandler(async (req) => {
        handleWebhookCalled = true;
        return { status: 200, body: { ok: true } };
      });

      await request(app)
        .post('/webhooks/mock-platform')
        .send({ event_type: 'test' })
        .expect(200);

      expect(handleWebhookCalled).toBe(true);
    });

    it('should handle signature verification before event processing', async () => {
      const callOrder: string[] = [];

      mockConnector.setSignatureValidator((req) => {
        callOrder.push('verifySignature');
        return true;
      });

      mockConnector.setWebhookHandler(async (req) => {
        callOrder.push('handleWebhook');
        return { status: 200, body: { ok: true } };
      });

      await request(app)
        .post('/webhooks/mock-platform')
        .send({ event_type: 'test' })
        .expect(200);

      expect(callOrder).toEqual(['verifySignature', 'handleWebhook']);
    });
  });
});

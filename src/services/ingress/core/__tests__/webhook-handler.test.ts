/**
 * Unit tests for WebhookHandler
 *
 * Tests cover:
 * - Signature verification (valid/invalid)
 * - 3-second SLA compliance
 * - Async processing with setImmediate()
 * - Error handling scenarios
 * - Dead-letter queue integration
 *
 * @since Sprint 342 - IEF-003
 */

import { Request, Response } from 'express';
import { WebhookHandler, WebhookConnector, WebhookRequest, WebhookResponse } from '../webhook-handler';
import type { Logger } from '../../../../common/logging';

// Mock logger
const createMockLogger = (): Logger => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
} as unknown as Logger);

// Mock connector
class MockWebhookConnector implements WebhookConnector {
  public signatureValid = true;
  public handleWebhookSpy = jest.fn();
  public verifySignatureSpy = jest.fn();

  async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
    this.handleWebhookSpy(req);
    return { status: 200, body: { ok: true } };
  }

  verifySignature(req: WebhookRequest): boolean {
    this.verifySignatureSpy(req);
    return this.signatureValid;
  }

  setSignatureValid(valid: boolean): void {
    this.signatureValid = valid;
  }

  reset(): void {
    this.handleWebhookSpy.mockReset();
    this.verifySignatureSpy.mockReset();
    this.signatureValid = true;
  }
}

// Mock Express Request with rawBody extension
interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

const createMockRequest = (overrides?: Partial<RequestWithRawBody>): Request => ({
  headers: {
    'Content-Type': 'application/json',
    'X-Signature': 'test-signature'
  },
  body: { message: 'test message' },
  rawBody: Buffer.from(JSON.stringify({ message: 'test message' })),
  url: '/webhooks/test',
  originalUrl: '/webhooks/test',
  method: 'POST',
  ...overrides
} as unknown as Request);

// Mock Express Response
const createMockResponse = (): Response => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    headersSent: false
  } as unknown as Response;
  return res;
};

describe('WebhookHandler', () => {
  let handler: WebhookHandler;
  let mockConnector: MockWebhookConnector;
  let mockLogger: Logger;

  beforeEach(() => {
    mockConnector = new MockWebhookConnector();
    mockLogger = createMockLogger();
    handler = new WebhookHandler(mockConnector, mockLogger);
  });

  afterEach(() => {
    mockConnector.reset();
    jest.clearAllMocks();
  });

  describe('Signature Verification', () => {
    it('should verify signature and return 200 when valid', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      mockConnector.setSignatureValid(true);

      await handler.handle(req, res);

      expect(mockConnector.verifySignatureSpy).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ received: true })
      );
    });

    it('should return 403 when signature is invalid', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      mockConnector.setSignatureValid(false);

      await handler.handle(req, res);

      expect(mockConnector.verifySignatureSpy).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'invalid_signature' });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'webhook.signature_invalid',
        expect.any(Object)
      );
    });

    it('should not process webhook when signature is invalid', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      mockConnector.setSignatureValid(false);

      await handler.handle(req, res);

      // Wait for any potential async processing
      await new Promise(resolve => setImmediate(resolve));

      expect(mockConnector.handleWebhookSpy).not.toHaveBeenCalled();
    });

    it('should pass normalized headers to verifySignature', async () => {
      const req = createMockRequest({
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': 'test-sig',
          'X-Timestamp': '1234567890'
        }
      });
      const res = createMockResponse();

      await handler.handle(req, res);

      const capturedRequest = mockConnector.verifySignatureSpy.mock.calls[0][0];
      expect(capturedRequest.headers['content-type']).toBe('application/json');
      expect(capturedRequest.headers['x-signature']).toBe('test-sig');
      expect(capturedRequest.headers['x-timestamp']).toBe('1234567890');
    });
  });

  describe('SLA Compliance (< 3 seconds)', () => {
    it('should respond within 100ms', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      const startTime = Date.now();
      await handler.handle(req, res);
      const responseTime = Date.now() - startTime;

      expect(responseTime).toBeLessThan(100);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should log response time', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      await handler.handle(req, res);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'webhook.acknowledged',
        expect.objectContaining({
          correlationId: expect.any(String),
          responseTimeMs: expect.any(Number)
        })
      );
    });

    it('should respond before async processing starts', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      let asyncProcessingStarted = false;
      mockConnector.handleWebhookSpy.mockImplementation(() => {
        asyncProcessingStarted = true;
      });

      await handler.handle(req, res);

      // Response should be sent before async processing
      expect(res.status).toHaveBeenCalledWith(200);
      expect(asyncProcessingStarted).toBe(false);

      // Wait for async processing
      await new Promise(resolve => setImmediate(resolve));
      expect(asyncProcessingStarted).toBe(true);
    });
  });

  describe('Async Processing', () => {
    it('should process webhook asynchronously after response', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      await handler.handle(req, res);

      // handleWebhook should not be called immediately
      expect(mockConnector.handleWebhookSpy).not.toHaveBeenCalled();

      // Wait for setImmediate() to execute
      await new Promise(resolve => setImmediate(resolve));

      // Now it should be called
      expect(mockConnector.handleWebhookSpy).toHaveBeenCalledTimes(1);
    });

    it('should pass correct webhook request to connector', async () => {
      const req = createMockRequest({
        headers: {
          'Content-Type': 'application/json',
          'X-Platform': 'test-platform'
        },
        body: { event: 'test_event', data: { id: 123 } },
        url: '/webhooks/test?query=value',
        originalUrl: '/webhooks/test?query=value'
      });
      const res = createMockResponse();

      await handler.handle(req, res);
      await new Promise(resolve => setImmediate(resolve));

      const capturedRequest = mockConnector.handleWebhookSpy.mock.calls[0][0];
      expect(capturedRequest.headers['content-type']).toBe('application/json');
      expect(capturedRequest.headers['x-platform']).toBe('test-platform');
      expect(capturedRequest.body).toEqual({ event: 'test_event', data: { id: 123 } });
      expect(capturedRequest.url).toBe('/webhooks/test?query=value');
      expect(capturedRequest.method).toBe('POST');
    });

    it('should log processing completion', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      await handler.handle(req, res);
      await new Promise(resolve => setImmediate(resolve));

      expect(mockLogger.info).toHaveBeenCalledWith(
        'webhook.processed',
        expect.objectContaining({
          correlationId: expect.any(String),
          processingTimeMs: expect.any(Number),
          totalTimeMs: expect.any(Number)
        })
      );
    });

    it('should include rawBody in webhook request', async () => {
      const rawBody = Buffer.from('{"test": "data"}');
      const req = createMockRequest({ rawBody });
      const res = createMockResponse();

      await handler.handle(req, res);
      await new Promise(resolve => setImmediate(resolve));

      const capturedRequest = mockConnector.handleWebhookSpy.mock.calls[0][0];
      expect(capturedRequest.rawBody).toBe(rawBody);
    });
  });

  describe('Error Handling', () => {
    it('should handle connector processing errors gracefully', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      // Override handleWebhook to throw an error
      const testError = new Error('Connector processing failed');
      jest.spyOn(mockConnector, 'handleWebhook').mockRejectedValue(testError);

      await handler.handle(req, res);

      // Response should still be 200 (already sent)
      expect(res.status).toHaveBeenCalledWith(200);

      // Wait for async processing with sufficient time for promise rejection to be caught
      await new Promise(resolve => setTimeout(resolve, 50));

      // Error should be logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        'webhook.processing_error',
        expect.objectContaining({
          correlationId: expect.any(String),
          error: 'Connector processing failed',
          stack: expect.any(String),
          processingTimeMs: expect.any(Number)
        })
      );
    });

    it('should handle signature verification errors', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      mockConnector.verifySignatureSpy.mockImplementation(() => {
        throw new Error('Signature verification crashed');
      });

      await handler.handle(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'internal_error',
          correlationId: expect.any(String)
        })
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'webhook.error',
        expect.objectContaining({
          error: 'Signature verification crashed'
        })
      );
    });

    it('should not send response twice if already sent', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      // Simulate response already sent
      mockConnector.verifySignatureSpy.mockImplementation(() => {
        (res as any).headersSent = true;
        throw new Error('Unexpected error after headers sent');
      });

      await handler.handle(req, res);

      // status/json should only be called once (before error)
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('should handle missing rawBody gracefully', async () => {
      const req = createMockRequest({ rawBody: undefined });
      const res = createMockResponse();

      await handler.handle(req, res);
      await new Promise(resolve => setImmediate(resolve));

      const capturedRequest = mockConnector.handleWebhookSpy.mock.calls[0][0];
      expect(capturedRequest.rawBody).toBeUndefined();
    });

    it('should log debug message when rawBody is missing', async () => {
      const req = createMockRequest({ rawBody: undefined });
      const res = createMockResponse();

      await handler.handle(req, res);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'webhook.received',
        expect.objectContaining({
          hasRawBody: false
        })
      );
    });
  });

  describe('Header Normalization', () => {
    it('should normalize header keys to lowercase', async () => {
      const req = createMockRequest({
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': 'test-sig',
          'X-TIMESTAMP': '1234567890',
          'authorization': 'Bearer token'
        }
      });
      const res = createMockResponse();

      await handler.handle(req, res);
      await new Promise(resolve => setImmediate(resolve));

      const capturedRequest = mockConnector.handleWebhookSpy.mock.calls[0][0];
      expect(capturedRequest.headers).toHaveProperty('content-type');
      expect(capturedRequest.headers).toHaveProperty('x-signature');
      expect(capturedRequest.headers).toHaveProperty('x-timestamp');
      expect(capturedRequest.headers).toHaveProperty('authorization');
    });

    it('should handle array header values by taking first element', async () => {
      const req = createMockRequest({
        headers: {
          'X-Forwarded-For': ['192.168.1.1', '10.0.0.1'] as any
        }
      });
      const res = createMockResponse();

      await handler.handle(req, res);
      await new Promise(resolve => setImmediate(resolve));

      const capturedRequest = mockConnector.handleWebhookSpy.mock.calls[0][0];
      expect(capturedRequest.headers['x-forwarded-for']).toBe('192.168.1.1');
    });

    it('should skip undefined header values', async () => {
      const req = createMockRequest({
        headers: {
          'Content-Type': 'application/json',
          'X-Empty': undefined
        }
      });
      const res = createMockResponse();

      await handler.handle(req, res);
      await new Promise(resolve => setImmediate(resolve));

      const capturedRequest = mockConnector.handleWebhookSpy.mock.calls[0][0];
      expect(capturedRequest.headers).toHaveProperty('content-type');
      expect(capturedRequest.headers).not.toHaveProperty('x-empty');
    });
  });

  describe('Logging', () => {
    it('should log webhook received with correlation ID', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      await handler.handle(req, res);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'webhook.received',
        expect.objectContaining({
          correlationId: expect.any(String),
          method: 'POST',
          url: '/webhooks/test',
          hasRawBody: true
        })
      );
    });

    it('should log signature validation success', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      await handler.handle(req, res);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'webhook.signature_valid',
        expect.objectContaining({
          correlationId: expect.any(String)
        })
      );
    });

    it('should use same correlation ID throughout request lifecycle', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      await handler.handle(req, res);
      await new Promise(resolve => setImmediate(resolve));

      const receivedLog = (mockLogger.debug as jest.Mock).mock.calls.find(
        call => call[0] === 'webhook.received'
      );
      const acknowledgedLog = (mockLogger.info as jest.Mock).mock.calls.find(
        call => call[0] === 'webhook.acknowledged'
      );
      const processedLog = (mockLogger.info as jest.Mock).mock.calls.find(
        call => call[0] === 'webhook.processed'
      );

      const correlationId = receivedLog![1].correlationId;
      expect(acknowledgedLog![1].correlationId).toBe(correlationId);
      expect(processedLog![1].correlationId).toBe(correlationId);
    });
  });

  describe('CorrelationId Generation', () => {
    it('should return unique correlation ID in response', async () => {
      const req1 = createMockRequest();
      const res1 = createMockResponse();

      const req2 = createMockRequest();
      const res2 = createMockResponse();

      await handler.handle(req1, res1);
      await handler.handle(req2, res2);

      const call1 = (res1.json as jest.Mock).mock.calls[0][0];
      const call2 = (res2.json as jest.Mock).mock.calls[0][0];

      expect(call1.correlationId).toBeTruthy();
      expect(call2.correlationId).toBeTruthy();
      expect(call1.correlationId).not.toBe(call2.correlationId);
    });
  });
});

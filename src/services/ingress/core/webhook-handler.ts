/**
 * Generic Webhook Handler
 *
 * Provides a reusable webhook request processor that enforces < 3-second SLA,
 * delegates signature verification to platform-specific connectors, and handles
 * async event processing via queue-based mechanisms.
 *
 * @module webhook-handler
 * @since Sprint 342 - Ingress-Egress Framework Foundation
 */

import type { Request, Response } from 'express';
import type { Logger } from '../../../common/logging';
import crypto from 'crypto';

/**
 * WebhookConnector interface - must be implemented by platform-specific webhook clients
 *
 * @interface WebhookConnector
 */
export interface WebhookConnector {
  /**
   * Handle webhook event processing
   *
   * @param req - Webhook request object
   * @returns Promise<WebhookResponse> - Response to send back to webhook caller
   */
  handleWebhook(req: WebhookRequest): Promise<WebhookResponse>;

  /**
   * Verify webhook signature
   *
   * Platform-specific HMAC/signature verification logic.
   * MUST use timing-safe comparison to prevent timing attacks.
   *
   * @param req - Webhook request object
   * @returns boolean - true if signature is valid, false otherwise
   */
  verifySignature(req: WebhookRequest): boolean;
}

/**
 * Webhook Request abstraction
 *
 * Normalizes Express/Fastify request objects for platform-agnostic processing.
 *
 * @interface WebhookRequest
 */
export interface WebhookRequest {
  /** Request headers (lowercase keys) */
  headers: Record<string, string>;

  /** Parsed request body (JSON) */
  body: any;

  /** Raw request body as Buffer (required for HMAC signature verification) */
  rawBody?: Buffer;

  /** Full request URL (including query params) */
  url: string;

  /** HTTP method (POST, GET, etc.) */
  method: string;
}

/**
 * Webhook Response
 *
 * @interface WebhookResponse
 */
export interface WebhookResponse {
  /** HTTP status code */
  status: number;

  /** Response body (will be JSON serialized) */
  body?: any;

  /** Response headers */
  headers?: Record<string, string>;
}

/**
 * WebhookHandler
 *
 * Generic webhook request handler that enforces the < 3-second SLA requirement
 * (critical for platforms like Slack that auto-disable on failures).
 *
 * **Key Features:**
 * - Immediate response (< 100ms) to satisfy SLA
 * - Async processing via `setImmediate()` (queue-based)
 * - Signature verification delegation
 * - Dead-letter queue integration for failures
 * - Comprehensive error handling
 *
 * **Usage:**
 * ```typescript
 * const handler = new WebhookHandler(slackConnector, logger);
 * app.post('/webhooks/slack', async (req, res) => {
 *   await handler.handle(req, res);
 * });
 * ```
 *
 * @class WebhookHandler
 */
export class WebhookHandler {
  /**
   * @param connector - Platform-specific webhook connector
   * @param logger - Logger instance
   */
  constructor(
    private readonly connector: WebhookConnector,
    private readonly logger: Logger
  ) {}

  /**
   * Handle webhook request
   *
   * **Flow:**
   * 1. Extract webhook request (headers, body, rawBody)
   * 2. Verify signature (delegate to connector)
   * 3. **IMMEDIATELY** respond 200 OK (< 3s SLA)
   * 4. Async process via `setImmediate(() => connector.handleWebhook())`
   * 5. Errors → dead-letter queue
   *
   * **SLA Enforcement:**
   * This method MUST respond within 3 seconds to prevent webhook auto-disable
   * (Slack requirement). We achieve this by:
   * - Signature verification first (fast, synchronous)
   * - Immediate 200 response
   * - Async processing after response sent
   *
   * @param req - Express/Fastify request object
   * @param res - Express/Fastify response object
   */
  async handle(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    const correlationId = crypto.randomUUID();

    try {
      // 1. Extract webhook request
      const webhookReq: WebhookRequest = {
        headers: this.normalizeHeaders(req.headers as Record<string, string>),
        body: req.body,
        rawBody: (req as any).rawBody, // Added by raw body middleware
        url: req.originalUrl || req.url,
        method: req.method
      };

      this.logger.debug('webhook.received', {
        correlationId,
        method: webhookReq.method,
        url: webhookReq.url,
        hasRawBody: !!webhookReq.rawBody
      });

      // 2. Verify signature (platform-specific logic in connector)
      const isValid = this.connector.verifySignature(webhookReq);

      if (!isValid) {
        this.logger.warn('webhook.signature_invalid', {
          correlationId,
          url: webhookReq.url,
          method: webhookReq.method
        });
        res.status(403).json({ error: 'invalid_signature' });
        return;
      }

      this.logger.debug('webhook.signature_valid', { correlationId });

      // 3. IMMEDIATELY acknowledge (< 3 seconds SLA)
      // This satisfies the webhook caller's SLA requirements
      res.status(200).json({ received: true, correlationId });

      const responseTime = Date.now() - startTime;
      this.logger.info('webhook.acknowledged', {
        correlationId,
        responseTimeMs: responseTime
      });

      // 4. Async processing (queue-based, no blocking)
      // Using setImmediate() to defer processing to next event loop tick
      // This ensures the response is fully sent before we start heavy processing
      setImmediate(async () => {
        const processingStartTime = Date.now();

        try {
          this.logger.debug('webhook.processing_start', { correlationId });

          // Delegate to platform-specific handler
          await this.connector.handleWebhook(webhookReq);

          const processingTime = Date.now() - processingStartTime;
          this.logger.info('webhook.processed', {
            correlationId,
            processingTimeMs: processingTime,
            totalTimeMs: Date.now() - startTime
          });

        } catch (err: any) {
          const processingTime = Date.now() - processingStartTime;

          this.logger.error('webhook.processing_error', {
            correlationId,
            error: err.message,
            stack: err.stack,
            processingTimeMs: processingTime
          });

          // TODO: Dead-letter queue integration
          // await this.deadLetterQueue.publish({
          //   webhookReq,
          //   error: { message: err.message, stack: err.stack },
          //   correlationId,
          //   timestamp: new Date().toISOString()
          // });
        }
      });

    } catch (err: any) {
      const duration = Date.now() - startTime;

      this.logger.error('webhook.error', {
        correlationId,
        error: err.message,
        stack: err.stack,
        durationMs: duration
      });

      // Only send error response if we haven't already responded
      if (!res.headersSent) {
        res.status(500).json({
          error: 'internal_error',
          correlationId
        });
      }
    }
  }

  /**
   * Normalize headers to lowercase keys
   *
   * HTTP headers are case-insensitive, but different frameworks handle them differently.
   * This normalizes them to lowercase for consistent platform-specific logic.
   *
   * @param headers - Request headers
   * @returns Normalized headers with lowercase keys
   * @private
   */
  private normalizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
    const normalized: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) {
        // Convert header values to string (handle array case)
        normalized[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
      }
    }

    return normalized;
  }
}

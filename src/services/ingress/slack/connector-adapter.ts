/**
 * Slack Connector Adapter
 *
 * Dual-mode connector for Slack:
 * - IngressConnector: Real-time message streaming via Socket Mode (WebSocket)
 * - WebhookConnector: Event notifications via Events API (webhooks)
 *
 * Sprint 348: Slack Integration
 *
 * @example
 * ```typescript
 * const client = new SlackIngressClient(appToken, botToken, publisher);
 * const adapter = new SlackConnectorAdapter(client, config);
 *
 * // Register with ConnectorManager
 * manager.register('slack', adapter);
 *
 * // Start Socket Mode client
 * await adapter.start();
 *
 * // Webhook route automatically delegates to adapter via WebhookHandler
 * // POST /webhooks/slack → adapter.verifySignature() → adapter.handleWebhook()
 * ```
 *
 * @since Sprint 348
 */

import type {
  IngressConnector,
  ConnectorSnapshot,
  WebhookConnector,
  WebhookRequest,
  WebhookResponse,
  ConnectorMetadata,
} from '../core';
import type { SlackIngressClient } from './slack-ingress-client';
import { logger } from '../../../common/logging';
import { validateSlackSignature } from './webhook-utils';
import { buildSlackEnvelope } from './envelope-builder';
import type { IConfig } from '../../../types';

export class SlackConnectorAdapter implements IngressConnector, WebhookConnector {
  constructor(
    private readonly client: SlackIngressClient,
    private readonly config?: IConfig
  ) {}

  //
  // IngressConnector implementation (Socket Mode)
  //

  async start(): Promise<void> {
    await this.client.start();
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  getSnapshot(): ConnectorSnapshot {
    return this.client.getSnapshot();
  }

  async sendText(text: string, target?: string): Promise<void> {
    logger.debug('slack.adapter.sendText', { target, textLength: text?.length });
    if (!target) {
      throw new Error('slack_connector_adapter.target_required');
    }

    try {
      await this.client.sendText(text, target);
      logger.info('slack.adapter.text_sent', { target });
    } catch (error: any) {
      logger.error('slack.adapter.send_failed', { error: error.message, target });
      throw error;
    }
  }

  //
  // WebhookConnector implementation (Events API)
  //

  verifySignature(req: WebhookRequest): boolean {
    const signature = req.headers['x-slack-signature'];
    const timestamp = req.headers['x-slack-request-timestamp'];

    if (!signature || !timestamp) {
      logger.warn('slack.webhook.missing_headers');
      return false;
    }

    const secret = this.config?.slackSigningSecret;
    if (!secret) {
      logger.error('slack.webhook.no_signing_secret');
      return false;
    }

    const valid = validateSlackSignature(
      secret,
      signature as string,
      timestamp as string,
      req.body
    );

    if (!valid) {
      logger.warn('slack.webhook.invalid_signature');
    }

    return valid;
  }

  async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
    const { type, challenge, event } = req.body;

    logger.debug('slack.webhook.received', { type, eventType: event?.type });

    // Handle URL verification challenge
    if (type === 'url_verification') {
      logger.info('slack.webhook.url_verification', { challenge });
      return { status: 200, body: { challenge } };
    }

    // Handle event callbacks
    if (type === 'event_callback') {
      // IMPORTANT: Return 200 OK immediately (< 3-second SLA)
      // Process event asynchronously after response
      setImmediate(async () => {
        try {
          const envelope = buildSlackEnvelope(event);
          // Access publisher through client
          await (this.client as any).publisher.publish(envelope);
          logger.debug('slack.webhook.event_published', {
            correlationId: envelope.correlationId,
            eventType: event.type,
          });
        } catch (err: any) {
          logger.error('slack.webhook.event_failed', { error: err.message });
        }
      });

      return { status: 200, body: { ok: true } };
    }

    logger.warn('slack.webhook.unsupported_type', { type });
    return { status: 400, body: { error: 'unsupported_event_type' } };
  }

  getMetadata(): ConnectorMetadata {
    return {
      platform: 'slack',
      version: '1.0.0',
      authMethod: 'oauth2',
      capabilities: {
        ingress: {
          method: 'hybrid', // Socket Mode (primary) + Events API (fallback)
          realtime: true,
          requiresWebhook: false, // Socket Mode doesn't require webhooks
          requiresPublicUrl: false, // Socket Mode doesn't require public URL
        },
        egress: {
          chat: true,
          dm: true,
          reactions: true,
          threads: true,
        },
        moderation: {
          ban: false, // Slack doesn't support banning via API
          timeout: false,
          delete: true, // Can delete messages
        },
      },
    };
  }
}

import type { IngressConnector, ConnectorSnapshot, WebhookConnector, WebhookRequest, WebhookResponse, ConnectorMetadata } from '../core';
import type { TwilioIngressClient, TwilioDebugSnapshot } from './twilio-ingress-client';
import { logger } from '../../../common/logging';
import { validateTwilioSignature } from './webhook-utils';
import { IConfig } from '../../../types';

/**
 * TwilioConnectorAdapter
 *
 * Implements both IngressConnector (for WebSocket client) and WebhookConnector (for webhook events).
 * Dual-mode support for Twilio Conversations:
 * - WebSocket mode: Real-time message streaming via TwilioIngressClient
 * - Webhook mode: Event notifications for conversation management (onConversationAdded, onMessageAdded)
 *
 * @since Sprint 342 - IEF-007
 */
export class TwilioConnectorAdapter implements IngressConnector, WebhookConnector {
  constructor(
    private readonly client: TwilioIngressClient,
    private readonly config?: IConfig
  ) {}

  /**
   * Starts the underlying Twilio client.
   */
  async start(): Promise<void> {
    await this.client.start();
  }

  /**
   * Stops the underlying Twilio client.
   */
  async stop(): Promise<void> {
    await this.client.stop();
  }

  /**
   * Returns a snapshot of the connector state.
   */
  getSnapshot(): ConnectorSnapshot {
    const s: TwilioDebugSnapshot = this.client.getSnapshot();
    return {
      ...s,
      state: s.state,
      id: s.identity,
      displayName: s.identity,
      lastError: s.lastError ? { message: s.lastError } : null,
      counters: s.counters ? { ...s.counters } : undefined,
      lastMessageAt: s.lastMessageAt,
    } as ConnectorSnapshot & Record<string, unknown>;
  }

  /**
   * Egress implementation: sends text to a Twilio conversation.
   * @param text The message body.
   * @param target The Conversation SID.
   */
  async sendText(text: string, target?: string): Promise<void> {
    logger.debug('twilio.adapter.sendText', { target, textLength: text?.length });
    if (!target) {
      throw new Error('twilio_connector_adapter.target_required');
    }
    await this.client.sendText(text, target);
  }

  /**
   * WebhookConnector: Verify Twilio webhook signature
   *
   * Uses Twilio's signature validation to ensure webhook authenticity.
   * Reconstructs the full URL (protocol + host + path) for signature verification.
   *
   * @param req - Webhook request
   * @returns true if signature is valid, false otherwise
   * @since Sprint 342 - IEF-007
   */
  verifySignature(req: WebhookRequest): boolean {
    const signature = req.headers['x-twilio-signature'];
    if (!signature) {
      logger.warn('twilio.webhook.missing_signature');
      return false;
    }

    if (!this.config?.twilioAuthToken) {
      logger.error('twilio.webhook.missing_auth_token_config');
      return false;
    }

    // Reconstruct the full URL for signature verification
    // In Cloud Run, req.protocol might be http but external URL is https
    // Twilio signs using the absolute URL as it was sent
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['host'];
    const url = `${protocol}://${host}${req.url}`;

    const isValid = validateTwilioSignature(this.config.twilioAuthToken, signature, url, req.body);

    if (!isValid) {
      logger.warn('twilio.webhook.invalid_signature', { url });
    }

    return isValid;
  }

  /**
   * WebhookConnector: Handle Twilio webhook event
   *
   * Processes Twilio Conversation webhook events (onConversationAdded, onMessageAdded).
   * Currently implements bot auto-join logic to ensure the bot participates in conversations.
   *
   * @param req - Webhook request
   * @returns Webhook response (200 OK)
   * @since Sprint 342 - IEF-007
   */
  async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
    const { EventType, ConversationSid } = req.body;

    logger.info('twilio.webhook.received', { EventType, ConversationSid });

    // Handle bot auto-join for new conversations or messages
    if (EventType === 'onConversationAdded' || EventType === 'onMessageAdded') {
      try {
        if (!this.config?.twilioAccountSid || !this.config?.twilioAuthToken) {
          logger.error('twilio.webhook.missing_credentials');
          return { status: 500, body: { error: 'misconfigured' } };
        }

        // Lazy-load twilio SDK
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const twilio = require('twilio');
        const twilioRest = twilio(this.config.twilioAccountSid, this.config.twilioAuthToken);
        const botIdentity = this.config.twilioIdentity;

        logger.info('twilio.webhook.inject_bot', { ConversationSid, botIdentity, trigger: EventType });

        await twilioRest.conversations.v1.conversations(ConversationSid)
          .participants
          .create({ identity: botIdentity });

        logger.info('twilio.webhook.inject_bot.ok', { ConversationSid, trigger: EventType });
      } catch (err: any) {
        // Handle "Already exists" errors (409 or 400 with specific code)
        if (err.code === 50433 || err.status === 409 || err.message?.includes('already exists')) {
          logger.info('twilio.webhook.inject_bot.already_participant', { ConversationSid, trigger: EventType });
        } else {
          logger.error('twilio.webhook.inject_bot.error', { ConversationSid, trigger: EventType, error: err.message });
        }
      }
    }

    return { status: 200, body: { ok: true } };
  }

  /**
   * Get connector metadata (capabilities, platform info)
   *
   * @since Sprint 342 - IEF-007
   */
  getMetadata(): ConnectorMetadata {
    return {
      platform: 'twilio',
      version: '1.0.0',
      authMethod: 'api_key',
      capabilities: {
        ingress: {
          method: 'hybrid', // WebSocket + webhook
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
    };
  }
}

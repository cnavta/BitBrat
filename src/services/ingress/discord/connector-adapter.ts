/**
 * Discord Connector Adapter
 *
 * Dual-mode connector for Discord:
 * - IngressConnector: Real-time message streaming via Discord Gateway (WebSocket)
 * - WebhookConnector: Slash commands and interactions via Interactions API (webhooks)
 *
 * Sprint 11: Discord Integration Modernization (DISC-005)
 *
 * @example
 * ```typescript
 * const client = new DiscordIngressClient(buildDiscordEnvelope, publisher, config);
 * const adapter = new DiscordConnectorAdapter(client, config);
 *
 * // Register with ConnectorManager
 * manager.register('discord', adapter);
 *
 * // Start Gateway client
 * await adapter.start();
 *
 * // Webhook route automatically delegates to adapter via WebhookHandler
 * // POST /webhooks/discord → adapter.verifySignature() → adapter.handleWebhook()
 * ```
 *
 * @since Sprint 11
 */

import type {
  IngressConnector,
  ConnectorSnapshot,
  WebhookConnector,
  WebhookRequest,
  WebhookResponse,
  ConnectorMetadata,
} from '../core';
import type { DiscordIngressClient } from './discord-ingress-client';
import { logger } from '../../../common/logging';
import { validateDiscordSignature, isTimestampValid } from './webhook-utils';
import type { IConfig } from '../../../types';

export class DiscordConnectorAdapter implements IngressConnector, WebhookConnector {
  constructor(
    private readonly client: DiscordIngressClient,
    private readonly config?: IConfig
  ) {}

  //
  // IngressConnector implementation (Discord Gateway)
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
    logger.debug('discord.adapter.sendText', { target, textLength: text?.length });
    if (!target) {
      throw new Error('discord_connector_adapter.target_required');
    }

    try {
      await this.client.sendText(text, target);
      logger.info('discord.adapter.text_sent', { target });
    } catch (error: any) {
      logger.error('discord.adapter.send_failed', { error: error.message, target });
      throw error;
    }
  }

  async banUser(platformUserId: string, reason?: string): Promise<void> {
    logger.debug('discord.adapter.banUser', { platformUserId, reason });
    try {
      await this.client.banUser(platformUserId, reason);
      logger.info('discord.adapter.user_banned', { platformUserId });
    } catch (error: any) {
      logger.error('discord.adapter.ban_failed', { error: error.message, platformUserId });
      throw error;
    }
  }

  //
  // WebhookConnector implementation (Discord Interactions API)
  //

  verifySignature(req: WebhookRequest): boolean {
    const signature = req.headers['x-signature-ed25519'];
    const timestamp = req.headers['x-signature-timestamp'];

    if (!signature || !timestamp) {
      logger.warn('discord.webhook.missing_headers');
      return false;
    }

    // Validate timestamp to prevent replay attacks
    if (!isTimestampValid(timestamp as string)) {
      logger.warn('discord.webhook.timestamp_invalid', { timestamp });
      return false;
    }

    const publicKey = this.config?.discordPublicKey;
    if (!publicKey) {
      logger.error('discord.webhook.no_public_key');
      return false;
    }

    const rawBody = req.rawBody || req.body;
    const valid = validateDiscordSignature(
      publicKey,
      signature as string,
      timestamp as string,
      rawBody
    );

    if (!valid) {
      logger.warn('discord.webhook.invalid_signature');
    }

    return valid;
  }

  async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
    const { type, data, id } = req.body;

    logger.debug('discord.webhook.received', { type, interactionId: id });

    // Handle ping interaction (Discord webhook verification)
    if (type === 1) {
      logger.info('discord.webhook.ping', { interactionId: id });
      return { status: 200, body: { type: 1 } };
    }

    // Handle application command (slash commands)
    if (type === 2) {
      const commandName = data?.name;
      logger.debug('discord.webhook.command', { commandName, interactionId: id });

      // IMPORTANT: Return 200 OK immediately (< 3-second SLA)
      // Respond with ephemeral acknowledgment
      // Process command asynchronously after response
      setImmediate(async () => {
        try {
          // TODO (DISC-010): Process interaction and publish envelope
          // For now, just log the interaction
          logger.info('discord.webhook.command_received', {
            interactionId: id,
            commandName,
            userId: req.body.member?.user?.id || req.body.user?.id,
          });
        } catch (err: any) {
          logger.error('discord.webhook.command_failed', { error: err.message, interactionId: id });
        }
      });

      // Respond with ephemeral message (only visible to user who triggered command)
      return {
        status: 200,
        body: {
          type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
          data: {
            content: `Command \`${commandName}\` received. Processing...`,
            flags: 64, // EPHEMERAL
          },
        },
      };
    }

    // Unsupported interaction type
    logger.warn('discord.webhook.unsupported_type', { type, interactionId: id });
    return { status: 400, body: { error: 'unsupported_interaction_type' } };
  }

  getMetadata(): ConnectorMetadata {
    return {
      platform: 'discord',
      version: '1.0.0',
      authMethod: 'bot_token',
      capabilities: {
        ingress: {
          method: 'hybrid', // Gateway (primary) + Interactions API (optional)
          realtime: true,
          requiresWebhook: false, // Gateway doesn't require webhooks
          requiresPublicUrl: false, // Gateway doesn't require public URL (Interactions API does if enabled)
        },
        egress: {
          chat: true,
          dm: true,
          reactions: true,
          threads: true,
        },
        moderation: {
          ban: true,
          timeout: true,
          delete: true,
        },
      },
    };
  }
}

/**
 * Ingress-Egress Service
 *
 * IntegrationBit-based multi-platform ingress/egress gateway.
 * Refactored in Sprint 12 to use the IntegrationBit pattern.
 *
 * @module ingress-egress-service
 * @since Sprint 12
 */

import { IntegrationBit, IntegrationBitConfig } from '../common/integration-bit';
import { createTwitchConnector } from '../services/ingress/twitch';
import { createDiscordConnector } from '../services/ingress/discord';
import { createSlackConnector } from '../services/ingress/slack';
import { createTwilioConnector } from '../services/ingress/twilio';
import { buildConfig } from '../common/config';
import type { IConfig } from '../types';
import { z } from 'zod';

const SERVICE_NAME = process.env.SERVICE_NAME || 'ingress-egress';
const PORT = buildConfig(process.env).port;

/**
 * Ingress-Egress Server
 *
 * Multi-platform ingress/egress gateway using IntegrationBit pattern.
 * Supports: Twitch, Discord, Slack, Twilio
 *
 * Architecture:
 * - Extends IntegrationBit for standardized connector management
 * - Registers platform-specific connector factories
 * - Automatic webhook routing via ConnectorManager
 * - Instance-specific egress subscription
 */
export class IngressEgressServer extends IntegrationBit {
  // Default configuration values
  protected static CONFIG_DEFAULTS: Record<string, any> = {
    PERSISTENCE_TTL_DAYS: 7,
  };

  constructor() {
    const config = buildConfig(process.env) as IConfig;

    // Configure IntegrationBit with connector factories
    const integrationConfig: IntegrationBitConfig = {
      serviceName: SERVICE_NAME,
      connectors: [
        // Twitch: Always enabled (primary platform)
        {
          name: 'twitch',
          factory: createTwitchConnector,
          enabled: true,
        },

        // Discord: Enabled by default, disable via DISCORD_ENABLED=false
        {
          name: 'discord',
          factory: createDiscordConnector,
          enabled: config.discordEnabled !== false,
        },

        // Slack: Opt-in, enable via SLACK_ENABLED=true
        {
          name: 'slack',
          factory: createSlackConnector,
          enabled: config.slackEnabled === true,
        },

        // Twilio: Opt-in, enable via TWILIO_ENABLED=true
        {
          name: 'twilio',
          factory: createTwilioConnector,
          enabled: config.twilioEnabled === true,
        },
      ],
    };

    super(integrationConfig);

    // Register EventSub observability tools (Sprint 16, M5 Phase 2)
    this.registerTools();

    // Setup EventSub health check endpoint (Sprint 16, M5-T4)
    this.setupEventSubDebugEndpoint();
  }

  /**
   * Register MCP tools for EventSub observability (Sprint 16, M5-T1, M5-T2, M5-T3)
   *
   * Provides runtime visibility and control for Twitch EventSub subscriptions:
   * - List subscription configurations from YAML
   * - Monitor subscription health status
   * - Reload YAML config without restart
   *
   * @private
   */
  private registerTools(): void {
    const logger = this.getLogger();

    // Get Twitch connector (may not be available if disabled)
    const twitchConnector = this.connectorManager.getConnector('twitch') as any;

    if (!twitchConnector) {
      logger.debug('ingress-egress.tools.twitch_not_available', {
        reason: 'Twitch connector not registered',
      });
      return;
    }

    // M5-T1: List EventSub subscription configurations
    this.registerTool(
      'twitch.eventsub.subscriptions.list',
      'List all EventSub subscription configurations from YAML',
      z.object({}),
      async () => {
        try {
          const config = twitchConnector.listSubscriptions?.();

          if (!config) {
            const result = {
              available: false,
              reason: 'EventSub not enabled or listSubscriptions() not implemented',
            };
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            };
          }

          const subscriptions = config.subscriptions || {};
          const enabled = Object.entries(subscriptions).filter(([_, cfg]: [string, any]) => cfg.enabled);

          const result = {
            version: config.version || 1,
            subscriptionCount: Object.keys(subscriptions).length,
            enabledCount: enabled.length,
            subscriptions,
            channelOverrides: config.channelOverrides || {},
          };

          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (error: any) {
          logger.error('ingress-egress.tools.list_subscriptions.error', {
            error: error.message,
            stack: error.stack,
          });
          const result = {
            error: error.message,
            available: false,
          };
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }
      }
    );

    // M5-T2: Get runtime EventSub subscription health status
    this.registerTool(
      'twitch.eventsub.subscriptions.status',
      'Get runtime EventSub subscription health status',
      z.object({
        channel: z.string().optional().describe('Filter by channel name'),
      }),
      async (args) => {
        try {
          const allStatus = twitchConnector.getSubscriptionStatus?.() || [];

          if (!allStatus || allStatus.length === 0) {
            const result = {
              available: false,
              reason: 'EventSub not enabled or no subscriptions active',
              subscriptions: [],
            };
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            };
          }

          const filtered = args.channel
            ? allStatus.filter((s: any) => s.channel === args.channel)
            : allStatus;

          const result = {
            totalSubscriptions: allStatus.length,
            filteredCount: filtered.length,
            subscriptions: filtered.map((s: any) => ({
              channel: s.channel,
              eventType: s.eventType,
              internalType: s.internalType,
              status: s.status,
              eventCount: s.eventCount,
              errorCount: s.errorCount,
              createdAt: s.createdAt,
              lastEventAt: s.lastEventAt,
              lastErrorAt: s.lastErrorAt,
            })),
          };

          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (error: any) {
          logger.error('ingress-egress.tools.subscription_status.error', {
            error: error.message,
            stack: error.stack,
          });
          const result = {
            error: error.message,
            available: false,
          };
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }
      }
    );

    // M5-T3: Reload EventSub YAML config without restart
    this.registerTool(
      'twitch.eventsub.config.reload',
      'Reload EventSub YAML config without restart (NOTE: Does not recreate subscriptions - requires service restart)',
      z.object({}),
      async () => {
        try {
          if (!twitchConnector.reloadSubscriptionConfig) {
            const result = {
              success: false,
              error: 'EventSub not enabled or reloadSubscriptionConfig() not implemented',
            };
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            };
          }

          await twitchConnector.reloadSubscriptionConfig();

          logger.info('ingress-egress.tools.config_reloaded');

          const result = {
            success: true,
            message: 'Config reloaded successfully',
            note: 'Existing subscriptions NOT updated - requires service restart to recreate subscriptions',
          };

          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (error: any) {
          logger.error('ingress-egress.tools.config_reload.error', {
            error: error.message,
            stack: error.stack,
          });
          const result = {
            success: false,
            error: error.message,
          };
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }
      }
    );

    logger.info('ingress-egress.tools.registered', {
      tools: [
        'twitch.eventsub.subscriptions.list',
        'twitch.eventsub.subscriptions.status',
        'twitch.eventsub.config.reload',
      ],
    });
  }

  /**
   * Setup EventSub health check debug endpoint (Sprint 16, M5-T4)
   *
   * Provides HTTP endpoint for monitoring EventSub subscription health:
   * GET /_debug/twitch/eventsub
   *
   * Returns:
   * - enabled: boolean (EventSub availability)
   * - useYamlConfig: boolean (YAML vs hardcoded subscriptions)
   * - subscriptionCount: number (total subscriptions)
   * - activeSubscriptions: number (subscriptions in active state)
   * - totalEvents: number (sum of all event counts)
   * - totalErrors: number (sum of all error counts)
   * - subscriptions: array (detailed per-subscription status)
   *
   * @private
   */
  private setupEventSubDebugEndpoint(): void {
    const logger = this.getLogger();
    const app = this.getApp();

    app.get('/_debug/twitch/eventsub', (req, res) => {
      try {
        const twitchConnector = this.connectorManager.getConnector('twitch') as any;

        if (!twitchConnector) {
          return res.json({
            enabled: false,
            reason: 'Twitch connector not registered',
          });
        }

        const snapshot = twitchConnector.getSnapshot?.() || {};
        const eventSubData = snapshot.eventSub;

        if (!eventSubData || !eventSubData.enabled) {
          return res.json({
            enabled: false,
            reason: 'EventSub not enabled',
          });
        }

        const status = twitchConnector.getSubscriptionStatus?.() || [];

        const result = {
          enabled: true,
          useYamlConfig: eventSubData.useYamlConfig,
          subscriptionCount: eventSubData.subscriptionCount,
          activeSubscriptions: status.filter((s: any) => s.status === 'active').length,
          totalEvents: status.reduce((sum: number, s: any) => sum + (s.eventCount || 0), 0),
          totalErrors: status.reduce((sum: number, s: any) => sum + (s.errorCount || 0), 0),
          subscriptions: status,
        };

        res.json(result);
      } catch (error: any) {
        logger.error('ingress-egress.eventsub_health_check.error', {
          error: error.message,
          stack: error.stack,
        });
        res.status(500).json({
          error: 'internal_error',
          message: error.message,
        });
      }
    });

    logger.info('ingress-egress.eventsub_debug_endpoint.setup', {
      path: '/_debug/twitch/eventsub',
    });
  }

  /**
   * Stop the service (backward compatibility alias for close())
   *
   * @deprecated Use close() instead
   */
  async stop(): Promise<void> {
    await this.close();
  }
}

/**
 * Express app factory (for testing)
 */
export function createApp() {
  const server = new IngressEgressServer();
  return server.getApp();
}

/**
 * Entry point for standalone execution
 */
if (require.main === module) {
  const server = new IngressEgressServer();
  void server.start(PORT);
}

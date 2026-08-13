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

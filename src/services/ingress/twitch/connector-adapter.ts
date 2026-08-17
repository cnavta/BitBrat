import type { IngressConnector, ConnectorSnapshot, ConnectorMetadata } from '../core';
import type { ITwitchIrcClient, TwitchIrcDebugSnapshot, TwitchConnectionState } from './twitch-irc-client';
import type { TwitchEventSubClient } from './eventsub-client';
import type { SubscriptionStatus } from './subscription-manager';
import { logger } from '../../../common/logging';

function mapState(state: TwitchConnectionState): ConnectorSnapshot['state'] {
  switch (state) {
    case 'CONNECTED':
      return 'CONNECTED';
    case 'CONNECTING':
    case 'RECONNECTING':
      return 'CONNECTING';
    case 'DISCONNECTED':
      return 'DISCONNECTED';
    case 'ERROR':
    default:
      return 'ERROR';
  }
}

/**
 * Twitch Connector Adapter
 *
 * Manages both IRC and EventSub clients for comprehensive Twitch integration.
 *
 * IRC Client:
 * - Chat messages (bidirectional realtime)
 * - Whispers/DMs
 * - Moderation actions (ban, timeout)
 *
 * EventSub Client:
 * - Platform events (follows, subs, raids, channel points, moderation, polls, predictions, hype trains)
 * - YAML-driven subscription management
 * - Feature flag controlled (ENABLE_EVENTSUB_YAML_CONFIG)
 *
 * @since Sprint 12 (IRC)
 * @since Sprint 16 (M5-INT-2: EventSub integration)
 */
export class TwitchConnectorAdapter implements IngressConnector {
  constructor(
    private readonly ircClient: ITwitchIrcClient,
    private readonly eventSubClient?: TwitchEventSubClient
  ) {}

  async start(): Promise<void> {
    // Start IRC client (always)
    await this.ircClient.start();

    // Start EventSub client (if provided and enabled via feature flag)
    if (this.eventSubClient) {
      try {
        await this.eventSubClient.start();
        logger.info('twitch.connector.eventsub.started', {
          useYamlConfig: process.env.ENABLE_EVENTSUB_YAML_CONFIG === 'true',
        });
      } catch (error: any) {
        // Fail-open: Log error but don't fail entire connector startup
        logger.error('twitch.connector.eventsub.start_failed', {
          error: error.message,
          stack: error.stack,
        });
      }
    }
  }

  async stop(): Promise<void> {
    // Stop IRC client
    await this.ircClient.stop();

    // Stop EventSub client (if present)
    if (this.eventSubClient) {
      try {
        await this.eventSubClient.stop();
        logger.info('twitch.connector.eventsub.stopped');
      } catch (error: any) {
        logger.error('twitch.connector.eventsub.stop_failed', {
          error: error.message,
        });
      }
    }
  }

  async banUser(platformUserId: string, reason?: string): Promise<void> {
    if (typeof (this.ircClient as any).banUser === 'function') {
      await (this.ircClient as any).banUser(platformUserId, reason);
    }
  }

  async sendText(text: string, target?: string): Promise<void> {
    if (typeof (this.ircClient as any).sendText === 'function') {
      await (this.ircClient as any).sendText(text, target);
    }
  }

  async sendWhisper(text: string, userId: string): Promise<void> {
    if (typeof (this.ircClient as any).sendWhisper === 'function') {
      await (this.ircClient as any).sendWhisper(text, userId);
    }
  }

  /**
   * Send direct message (whisper) to a Twitch user
   *
   * Alias for sendWhisper() to maintain consistency with other platforms.
   *
   * @param text - Message content
   * @param userId - Twitch user ID or login
   * @throws Error if whispers not supported or user not found
   * @since Sprint 13 (DM-007)
   */
  async sendDM(text: string, userId: string): Promise<void> {
    await this.sendWhisper(text, userId);
  }

  getMetadata(): ConnectorMetadata {
    return {
      platform: 'twitch',
      version: '1.0.0',
      authMethod: 'oauth2',
      capabilities: {
        ingress: {
          method: 'websocket',
          realtime: true,
          requiresWebhook: false,
          requiresPublicUrl: false,
        },
        egress: {
          chat: true,
          dm: true,
          reactions: false,
          threads: false,
        },
        moderation: {
          ban: true,
          timeout: true,
          delete: true,
        },
      },
    };
  }

  getSnapshot(): ConnectorSnapshot {
    const ircSnapshot: TwitchIrcDebugSnapshot = this.ircClient.getSnapshot();

    const baseSnapshot: ConnectorSnapshot = {
      state: mapState(ircSnapshot.state),
      id: ircSnapshot.userId,
      displayName: ircSnapshot.displayName,
      lastError: ircSnapshot.lastError || undefined,
      counters: ircSnapshot.counters || undefined,
      joinedChannels: Array.isArray(ircSnapshot.joinedChannels) ? [...ircSnapshot.joinedChannels] : [],
      reconnects: ircSnapshot.reconnects,
      lastMessageAt: ircSnapshot.lastMessageAt,
    };

    // Include EventSub data if client is present
    if (this.eventSubClient) {
      const eventSubSnapshot = this.eventSubClient.getSnapshot();
      return {
        ...baseSnapshot,
        eventSub: {
          enabled: true,
          state: eventSubSnapshot.state,
          useYamlConfig: eventSubSnapshot.useYamlConfig,
          subscriptionCount: eventSubSnapshot.subscriptions,
          activeSubscriptions: (eventSubSnapshot.subscriptionStatus || []).filter((s: any) => s.status === 'active').length,
          subscriptionStatus: eventSubSnapshot.subscriptionStatus || [],
        },
      } as ConnectorSnapshot & Record<string, unknown>;
    }

    return baseSnapshot as ConnectorSnapshot & Record<string, unknown>;
  }

  /**
   * Get EventSub subscription status for monitoring.
   * Used by MCP tools (M5-T2).
   *
   * @returns Array of subscription status objects, or empty array if EventSub not enabled
   * @since Sprint 16 (M5-INT-2)
   */
  getSubscriptionStatus(): SubscriptionStatus[] {
    if (!this.eventSubClient) {
      return [];
    }
    const snapshot = this.eventSubClient.getSnapshot();
    return snapshot.subscriptionStatus || [];
  }

  /**
   * Reload EventSub subscription configuration without restart.
   * Used by MCP tool (M5-T3).
   *
   * NOTE: This only reloads the YAML config in memory.
   * Existing subscriptions are NOT recreated - requires service restart.
   *
   * @throws Error if EventSub not enabled
   * @since Sprint 16 (M5-INT-2)
   */
  async reloadSubscriptionConfig(): Promise<void> {
    if (!this.eventSubClient) {
      throw new Error('EventSub not enabled - client not available');
    }

    // Access subscription manager via client internals
    // Note: subscriptionManager is private, but we need access for MCP tools
    const manager = (this.eventSubClient as any).subscriptionManager;
    if (!manager) {
      throw new Error('Subscription manager not available - YAML config may not be enabled');
    }

    await manager.reloadConfig();
    logger.info('twitch.connector.config_reloaded');
  }

  /**
   * List EventSub subscription configurations from YAML.
   * Used by MCP tool (M5-T1).
   *
   * @returns Subscription config object or empty config if EventSub not enabled
   * @since Sprint 16 (M5-INT-2)
   */
  listSubscriptions(): any {
    if (!this.eventSubClient) {
      return { version: 1, subscriptions: {}, channelOverrides: {} };
    }

    // Access loaded config via client internals
    const manager = (this.eventSubClient as any).subscriptionManager;
    if (!manager) {
      return { version: 1, subscriptions: {}, channelOverrides: {} };
    }

    const config = (manager as any).config;
    return config || { version: 1, subscriptions: {}, channelOverrides: {} };
  }
}

import { EventSubWsListener } from '@twurple/eventsub-ws';
import { ApiClient } from '@twurple/api';
import { logger } from '../../../common/logging';
import { EventBuilderRegistry } from './event-builder-registry';
import { SubscriptionConfigLoader, SubscriptionConfig, EventSubscriptionConfig } from './subscription-config-loader';
import { ITwitchIngressPublisher } from './publisher';
import { MutationProposal, INTERNAL_STATE_MUTATION_V1 } from '../../../types/state';
import { v4 as uuidv4 } from 'uuid';
import { MessagePublisher } from '../../message-bus';

/**
 * SubscriptionManager - Orchestrates EventSub subscriptions using YAML config.
 *
 * Responsibilities:
 * - Load subscription configuration from YAML
 * - Apply per-channel overrides
 * - Validate OAuth scopes before subscribing
 * - Map event types to Twurple listener methods
 * - Create subscriptions with event handlers
 * - Publish InternalEventV2 to message bus
 * - Publish state mutations (if configured)
 * - Track subscription health metrics
 * - Provide subscription status for monitoring
 *
 * @example
 * const manager = new SubscriptionManager(
 *   listener,
 *   apiClient,
 *   publisher,
 *   mutationPublisher,
 *   configPath
 * );
 * await manager.subscribeChannel('bitbrat', egressTopic);
 */
export class SubscriptionManager {
  private readonly registry: EventBuilderRegistry;
  private readonly configLoader: SubscriptionConfigLoader;
  private readonly subscriptionStatus: Map<string, SubscriptionStatus> = new Map();
  private config: SubscriptionConfig | null = null;

  constructor(
    private readonly listener: EventSubWsListener,
    private readonly apiClient: ApiClient,
    private readonly publisher: ITwitchIngressPublisher,
    private readonly mutationPublisher: MessagePublisher | null,
    configPath?: string
  ) {
    this.registry = new EventBuilderRegistry();
    this.configLoader = new SubscriptionConfigLoader(configPath);

    logger.info('subscription_manager.initialized', {
      builderCount: this.registry.count(),
      builders: this.registry.list()
    });
  }

  /**
   * Subscribe to all enabled events for a channel.
   *
   * Flow:
   * 1. Load subscription config (cached)
   * 2. Resolve channel user ID
   * 3. Apply channel-specific overrides
   * 4. For each enabled subscription:
   *    - Validate builder exists
   *    - Validate OAuth scope (if required)
   *    - Call subscribe() to create subscription
   * 5. Log summary
   *
   * @param channelName - Twitch channel name
   * @param userId - Twitch user ID for the channel
   * @param moderatorUserId - Moderator user ID (for scoped subscriptions like channel.follow)
   * @param egressTopic - Destination topic for InternalEventV2
   */
  async subscribeChannel(
    channelName: string,
    userId: string,
    moderatorUserId: string,
    egressTopic?: string
  ): Promise<void> {
    // Load config (cached after first load)
    if (!this.config) {
      this.config = await this.configLoader.load();
    }

    logger.info('subscription_manager.subscribing_channel', {
      channel: channelName,
      userId,
      moderatorUserId
    });

    // Apply channel-specific overrides
    const channelConfig = this.applyChannelOverrides(channelName, this.config);

    let enabledCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    // Iterate over all subscriptions
    for (const [eventType, eventConfig] of Object.entries(channelConfig.subscriptions)) {
      if (!eventConfig.enabled) {
        continue; // Skip disabled events
      }

      try {
        // Validate builder exists
        const builder = this.registry.get(eventConfig.builder);
        if (!builder) {
          logger.warn('subscription_manager.builder_not_found', {
            eventType,
            builder: eventConfig.builder,
            channel: channelName
          });
          skippedCount++;
          errors.push(`${eventType}: builder not found`);
          continue;
        }

        // Validate OAuth scope (if required)
        if (eventConfig.scope) {
          const hasScope = await this.validateScope(eventConfig.scope);
          if (!hasScope) {
            logger.warn('subscription_manager.scope_missing', {
              eventType,
              scope: eventConfig.scope,
              channel: channelName
            });
            skippedCount++;
            errors.push(`${eventType}: scope missing (${eventConfig.scope})`);
            continue;
          }
        }

        // Subscribe to event
        await this.subscribe(
          channelName,
          userId,
          moderatorUserId,
          eventType,
          eventConfig,
          builder,
          egressTopic
        );

        enabledCount++;
      } catch (err: any) {
        logger.error('subscription_manager.subscribe_failed', {
          eventType,
          channel: channelName,
          error: err.message,
          stack: err.stack
        });
        errors.push(`${eventType}: ${err.message}`);
      }
    }

    logger.info('subscription_manager.channel_subscribed', {
      channel: channelName,
      enabled: enabledCount,
      skipped: skippedCount,
      errors: errors.length > 0 ? errors : undefined
    });
  }

  /**
   * Create a single EventSub subscription.
   *
   * Flow:
   * 1. Get listener method name for event type
   * 2. Call listener method with event handler
   * 3. Event handler:
   *    - Builds InternalEventV2 using builder
   *    - Publishes to message bus
   *    - Publishes mutation (if configured)
   *    - Updates metrics
   * 4. Track subscription in status map
   *
   * @param channelName - Twitch channel name
   * @param userId - Twitch user ID
   * @param moderatorUserId - Moderator user ID (for scoped subscriptions)
   * @param eventType - EventSub event type (e.g., 'channel.follow')
   * @param eventConfig - Subscription configuration
   * @param builder - EventBuilder function
   * @param egressTopic - Destination topic for InternalEventV2
   */
  private async subscribe(
    channelName: string,
    userId: string,
    moderatorUserId: string,
    eventType: string,
    eventConfig: EventSubscriptionConfig,
    builder: any,
    egressTopic?: string
  ): Promise<void> {
    // Get listener method
    const listenerMethod = this.getListenerMethod(eventType);
    if (!listenerMethod) {
      throw new Error(`subscription_manager_no_listener_method: ${eventType}`);
    }

    // Verify listener method exists
    if (typeof (this.listener as any)[listenerMethod] !== 'function') {
      throw new Error(`subscription_manager_listener_method_not_found: ${listenerMethod}`);
    }

    // Create subscription with event handler
    const handler = async (event: any) => {
      try {
        logger.info('subscription_manager.event_received', {
          eventType,
          channel: channelName,
          event: this.sanitizeEventForLogging(event)
        });

        // Build InternalEventV2
        const internalEvent = builder(event, {
          finalizationDestination: egressTopic
        });

        // Publish to message bus
        await this.publisher.publish(internalEvent);

        // Publish mutation (if configured)
        if (eventConfig.mutation) {
          await this.publishMutation(eventConfig.mutation, event, eventType);
        }

        // Update metrics
        this.updateMetrics(channelName, eventType, 'success');

        logger.debug('subscription_manager.event_processed', {
          eventType,
          channel: channelName,
          internalType: eventConfig.internalType
        });
      } catch (err: any) {
        logger.error('subscription_manager.handler_error', {
          eventType,
          channel: channelName,
          error: err.message,
          stack: err.stack
        });
        this.updateMetrics(channelName, eventType, 'error');
      }
    };

    // Call listener method with appropriate arguments
    // Different event types require different arguments
    let subscription: any;

    if (eventType === 'channel.follow') {
      // channel.follow requires moderator user ID
      subscription = (this.listener as any)[listenerMethod](userId, moderatorUserId, handler);
    } else {
      // Most events just need broadcaster user ID
      subscription = (this.listener as any)[listenerMethod](userId, handler);
    }

    // Track subscription
    const statusKey = `${channelName}:${eventType}`;
    this.subscriptionStatus.set(statusKey, {
      channel: channelName,
      eventType,
      status: 'active',
      eventCount: 0,
      errorCount: 0,
      createdAt: new Date().toISOString(),
      lastEventAt: null,
      lastErrorAt: null
    });

    logger.debug('subscription_manager.subscribed', {
      eventType,
      channel: channelName,
      listenerMethod,
      internalType: eventConfig.internalType
    });
  }

  /**
   * Publish state mutation proposal.
   *
   * @param mutation - Mutation config from YAML
   * @param event - EventSub event
   * @param eventType - EventSub event type
   */
  private async publishMutation(
    mutation: { key: string; value: string | number | boolean; ttl?: number },
    event: any,
    eventType: string
  ): Promise<void> {
    if (!this.mutationPublisher) {
      logger.warn('subscription_manager.mutation_publisher_unavailable', { eventType });
      return;
    }

    const proposal: MutationProposal = {
      id: uuidv4(),
      op: 'set',
      key: mutation.key,
      value: mutation.value,
      actor: 'ingress-egress:twitch',
      reason: `Twitch EventSub: ${eventType}`,
      ts: new Date().toISOString(),
      ttl: mutation.ttl,
      metadata: {
        eventType,
        broadcasterId: event.broadcasterId,
        broadcasterName: event.broadcasterName
      }
    };

    try {
      logger.info('subscription_manager.mutation_publishing', {
        key: mutation.key,
        value: mutation.value,
        eventType
      });
      await this.mutationPublisher.publishJson(proposal);
    } catch (err: any) {
      logger.error('subscription_manager.mutation_publish_failed', {
        key: mutation.key,
        error: err.message
      });
    }
  }

  /**
   * Map EventSub event type to Twurple listener method name.
   *
   * Examples:
   * - channel.follow → onChannelFollow
   * - channel.update → onChannelUpdate
   * - stream.online → onStreamOnline
   * - channel.raid → onChannelRaidTo
   * - channel.subscribe → onChannelSubscription
   *
   * @param eventType - EventSub event type
   * @returns Listener method name or null if not found
   */
  private getListenerMethod(eventType: string): string | null {
    // Mapping of EventSub types to Twurple listener methods
    const mapping: Record<string, string> = {
      // Existing events (M1)
      'channel.follow': 'onChannelFollow',
      'channel.update': 'onChannelUpdate',
      'stream.online': 'onStreamOnline',
      'stream.offline': 'onStreamOffline',

      // Tier 1 events (M3) - to be verified against Twurple API
      'channel.raid': 'onChannelRaidTo',
      'channel.subscribe': 'onChannelSubscription',
      'channel.subscription.message': 'onChannelSubscriptionMessage',
      'channel.subscription.gift': 'onChannelSubscriptionGift',
      'channel.cheer': 'onChannelCheer',
      'channel.channel_points_custom_reward_redemption.add': 'onChannelRedemptionAdd',
      'channel.hype_train.begin': 'onChannelHypeTrainBegin',
      'channel.hype_train.progress': 'onChannelHypeTrainProgress',
      'channel.hype_train.end': 'onChannelHypeTrainEnd',
      'channel.poll.begin': 'onChannelPollBegin',
      'channel.poll.end': 'onChannelPollEnd',
      'channel.prediction.begin': 'onChannelPredictionBegin',
      'channel.prediction.end': 'onChannelPredictionEnd',

      // Tier 2 events (M4)
      'channel.ban': 'onChannelBan',
      'channel.unban': 'onChannelUnban',
      'channel.moderate': 'onChannelModeratorAction',
      'channel.chat.message': 'onChannelChatMessage',
      'channel.chat.message_delete': 'onChannelChatMessageDelete'
    };

    const method = mapping[eventType];
    if (!method) {
      logger.warn('subscription_manager.listener_method_unknown', {
        eventType,
        availableMethods: Object.keys(mapping)
      });
      return null;
    }

    return method;
  }

  /**
   * Validate that the current OAuth token has the required scope.
   *
   * @param requiredScope - OAuth scope required by the subscription
   * @returns True if scope is present, false otherwise
   */
  private async validateScope(requiredScope: string): Promise<boolean> {
    try {
      const tokenInfo = await this.apiClient.getTokenInfo();
      if (!tokenInfo || !tokenInfo.scopes) {
        logger.warn('subscription_manager.token_info_unavailable');
        return false;
      }

      const hasScope = tokenInfo.scopes.includes(requiredScope);
      logger.debug('subscription_manager.scope_validated', {
        requiredScope,
        hasScope,
        availableScopes: tokenInfo.scopes
      });

      return hasScope;
    } catch (err: any) {
      logger.error('subscription_manager.scope_validation_failed', {
        requiredScope,
        error: err.message
      });
      return false; // Fail-open: proceed without scope validation on API error
    }
  }

  /**
   * Apply channel-specific overrides to subscription config.
   *
   * @param channelName - Twitch channel name
   * @param config - Base subscription configuration
   * @returns Merged configuration with overrides applied
   */
  private applyChannelOverrides(
    channelName: string,
    config: SubscriptionConfig
  ): SubscriptionConfig {
    if (!config.channelOverrides || !config.channelOverrides[channelName]) {
      return config; // No overrides for this channel
    }

    const overrides = config.channelOverrides[channelName];
    const mergedSubscriptions = { ...config.subscriptions };

    for (const [eventType, override] of Object.entries(overrides)) {
      if (mergedSubscriptions[eventType]) {
        mergedSubscriptions[eventType] = {
          ...mergedSubscriptions[eventType],
          ...override
        };
      }
    }

    logger.debug('subscription_manager.overrides_applied', {
      channel: channelName,
      overrides: Object.keys(overrides)
    });

    return {
      ...config,
      subscriptions: mergedSubscriptions
    };
  }

  /**
   * Update subscription health metrics.
   *
   * @param channel - Twitch channel name
   * @param eventType - EventSub event type
   * @param outcome - 'success' or 'error'
   */
  private updateMetrics(channel: string, eventType: string, outcome: 'success' | 'error'): void {
    const statusKey = `${channel}:${eventType}`;
    const status = this.subscriptionStatus.get(statusKey);

    if (!status) {
      logger.warn('subscription_manager.status_not_found', { channel, eventType });
      return;
    }

    if (outcome === 'success') {
      status.eventCount++;
      status.lastEventAt = new Date().toISOString();
    } else {
      status.errorCount++;
      status.lastErrorAt = new Date().toISOString();
    }

    this.subscriptionStatus.set(statusKey, status);
  }

  /**
   * Get subscription status for all channels.
   * Used for monitoring and diagnostics.
   *
   * @returns Array of subscription status objects
   */
  getStatus(): SubscriptionStatus[] {
    return Array.from(this.subscriptionStatus.values());
  }

  /**
   * Reload subscription configuration without service restart.
   * Useful for runtime config updates.
   *
   * Note: Existing subscriptions are NOT automatically updated.
   * This only affects NEW subscriptions created after reload.
   */
  async reloadConfig(): Promise<void> {
    logger.info('subscription_manager.reloading_config');
    this.config = await this.configLoader.reload();
    logger.info('subscription_manager.config_reloaded', {
      subscriptions: Object.keys(this.config.subscriptions).length
    });
  }

  /**
   * Sanitize event data for logging (remove sensitive fields).
   *
   * @param event - EventSub event
   * @returns Sanitized event for logging
   */
  private sanitizeEventForLogging(event: any): any {
    // Return only safe fields for logging
    return {
      id: event.id,
      type: event.type,
      broadcasterId: event.broadcasterId,
      broadcasterName: event.broadcasterName,
      userId: event.userId,
      userName: event.userName
    };
  }
}

/**
 * Subscription status for monitoring.
 */
export interface SubscriptionStatus {
  channel: string;
  eventType: string;
  status: 'active' | 'error' | 'unsubscribed';
  eventCount: number;
  errorCount: number;
  createdAt: string;
  lastEventAt: string | null;
  lastErrorAt: string | null;
}

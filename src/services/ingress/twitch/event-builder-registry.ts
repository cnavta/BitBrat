import { EventSubEnvelopeBuilder } from './eventsub-envelope-builder';
import { InternalEventV2 } from '../../../types/events';
import { EnvelopeBuilderOptions } from './envelope-builder';
import { logger } from '../../../common/logging';

/**
 * EventBuilderRegistry - Registry for EventSub event builders.
 *
 * Maps EventSub event types to builder methods in EventSubEnvelopeBuilder.
 * Enables dynamic subscription management based on YAML configuration.
 *
 * Design:
 * - Singleton pattern (one instance per TwitchEventSubClient)
 * - Fail-open strategy: returns null if builder not found (no throw)
 * - Handles duplicate registration gracefully (logs warning)
 * - Initializes with existing 4 builders, extensible for new events
 *
 * @example
 * const registry = new EventBuilderRegistry();
 * const builder = registry.get('buildFollow');
 * if (builder) {
 *   const event = builder(twitchEvent, { finalizationDestination: 'topic' });
 * }
 */
export class EventBuilderRegistry {
  private readonly builder: EventSubEnvelopeBuilder;
  private readonly registry: Map<string, EventBuilderFunction> = new Map();

  constructor() {
    this.builder = new EventSubEnvelopeBuilder();
    this.registerBuilders();
  }

  /**
   * Register all available builders.
   * Called by constructor to initialize registry with existing builders.
   */
  private registerBuilders(): void {
    // Existing builders (Tier 1 - already implemented in eventsub-envelope-builder.ts)
    this.register('buildFollow', this.builder.buildFollow.bind(this.builder));
    this.register('buildUpdate', this.builder.buildUpdate.bind(this.builder));
    this.register('buildStreamOnline', this.builder.buildStreamOnline.bind(this.builder));
    this.register('buildStreamOffline', this.builder.buildStreamOffline.bind(this.builder));

    // Tier 1 builders (M3 - high priority events)
    this.register('buildRaid', this.builder.buildRaid.bind(this.builder));
    this.register('buildSubscribe', this.builder.buildSubscribe.bind(this.builder));
    this.register('buildSubscriptionMessage', this.builder.buildSubscriptionMessage.bind(this.builder));
    this.register('buildSubscriptionGift', this.builder.buildSubscriptionGift.bind(this.builder));
    this.register('buildCheer', this.builder.buildCheer.bind(this.builder));
    this.register('buildChannelPointsRedemption', this.builder.buildChannelPointsRedemption.bind(this.builder));
    this.register('buildHypeTrainBegin', this.builder.buildHypeTrainBegin.bind(this.builder));
    this.register('buildHypeTrainProgress', this.builder.buildHypeTrainProgress.bind(this.builder));
    this.register('buildHypeTrainEnd', this.builder.buildHypeTrainEnd.bind(this.builder));
    this.register('buildPollBegin', this.builder.buildPollBegin.bind(this.builder));
    this.register('buildPollEnd', this.builder.buildPollEnd.bind(this.builder));
    this.register('buildPredictionBegin', this.builder.buildPredictionBegin.bind(this.builder));
    this.register('buildPredictionEnd', this.builder.buildPredictionEnd.bind(this.builder));

    // Tier 2 builders - moderation events (M4)
    this.register('buildBan', this.builder.buildBan.bind(this.builder));
    this.register('buildUnban', this.builder.buildUnban.bind(this.builder));
    this.register('buildModerate', this.builder.buildModerate.bind(this.builder));

    // Tier 2 builders - chat events (overlap with IRC)
    this.register('buildChatMessage', this.builder.buildChatMessage.bind(this.builder));
    this.register('buildChatMessageDelete', this.builder.buildChatMessageDelete.bind(this.builder));

    logger.info('eventsub.builder_registry.initialized', {
      builders: this.registry.size,
      builderNames: this.list()
    });
  }

  /**
   * Register a builder function.
   * Handles duplicate registration gracefully (logs warning, overwrites).
   *
   * @param name - Builder method name (e.g., 'buildFollow')
   * @param fn - Builder function
   */
  private register(name: string, fn: EventBuilderFunction): void {
    if (this.registry.has(name)) {
      logger.warn('eventsub.builder_registry.duplicate', {
        name,
        action: 'overwriting existing builder'
      });
    }
    this.registry.set(name, fn);
  }

  /**
   * Get a builder by name.
   * Returns null if not found (fail-open strategy).
   *
   * @param name - Builder method name
   * @returns Builder function or null if not found
   */
  get(name: string): EventBuilderFunction | null {
    const builder = this.registry.get(name);
    if (!builder) {
      logger.warn('eventsub.builder_registry.not_found', {
        name,
        availableBuilders: this.list()
      });
      return null;
    }
    return builder;
  }

  /**
   * Check if a builder exists.
   *
   * @param name - Builder method name
   * @returns True if builder exists, false otherwise
   */
  has(name: string): boolean {
    return this.registry.has(name);
  }

  /**
   * List all registered builders.
   * Useful for debugging and validation.
   *
   * @returns Array of builder method names
   */
  list(): string[] {
    return Array.from(this.registry.keys());
  }

  /**
   * Get count of registered builders.
   *
   * @returns Number of builders in registry
   */
  count(): number {
    return this.registry.size;
  }
}

/**
 * Event builder function signature.
 * Maps a Twitch EventSub event to an InternalEventV2 envelope.
 *
 * @param event - Twitch EventSub event (type varies by event type)
 * @param opts - Builder options (finalizationDestination, uuid, nowIso)
 * @returns InternalEventV2 envelope
 */
export type EventBuilderFunction = (event: any, opts?: EnvelopeBuilderOptions) => InternalEventV2;

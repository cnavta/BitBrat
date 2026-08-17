/**
 * Translation Engine
 *
 * Central translation layer that converts platform-specific events to BitBrat's
 * InternalEventV2 format using config-driven mappings and the generic envelope builder.
 *
 * Architecture:
 * 1. Look up event mapping in ConfigRegistry
 * 2. Use custom builder if specified
 * 3. Otherwise use buildGenericEnvelope with field mapping
 * 4. Validate against schema (optional)
 *
 * Sprint 13: DX Foundation (DX-004)
 *
 * @example
 * ```typescript
 * const engine = new TranslationEngine(registry);
 *
 * // Translate platform event
 * const envelope = await engine.translateInbound('discord', 'MESSAGE_CREATE', {
 *   channel: { type: 1, id: 'C123' },
 *   author: { id: 'U123', username: 'john' },
 *   content: 'Hello!'
 * });
 *
 * console.log(envelope.type); // 'dm.message.v1'
 * ```
 *
 * @since Sprint 13
 */

import type { InternalEventV2 } from '../../../types/events';
import type { ConfigRegistry, PlatformEventMapping } from './config-registry';
import { buildGenericEnvelope, type GenericBuilderContext } from './generic-envelope-builder';
import { logger } from '../../../common/logging';
import { getFeatureFlags, logFeatureFlagStatus } from './feature-flags';

/**
 * Custom envelope builder function signature
 *
 * Platforms can provide custom builders for complex event types
 * that don't fit the generic field mapping pattern.
 */
export type CustomEnvelopeBuilder = (
  platformEvent: any,
  opts?: {
    uuid?: () => string;
    nowIso?: () => string;
    egressDestination?: string;
    correlationId?: string;
    [key: string]: any;
  }
) => InternalEventV2;

/**
 * Translation Engine Options
 */
export interface TranslationEngineOptions {
  /**
   * Whether to validate events against JSON schemas
   * @default false
   */
  validateSchema?: boolean;

  /**
   * Custom envelope builders by platform and event type
   * Key format: "platform:eventType" (e.g., "discord:chat.message.v1")
   */
  customBuilders?: Map<string, CustomEnvelopeBuilder>;
}

/**
 * Translation Engine
 *
 * Translates platform-specific events to InternalEventV2 using config-driven mappings.
 *
 * Features:
 * - Config-based event registry lookup (controlled by ENABLE_CONFIG_REGISTRY flag)
 * - Generic envelope builder for standard mappings (controlled by ENABLE_GENERIC_BUILDER flag)
 * - Custom builder fallback for complex cases
 * - Optional JSON schema validation
 * - Backward compatible with existing builders
 *
 * @since Sprint 13
 */
export class TranslationEngine {
  private readonly customBuilders: Map<string, CustomEnvelopeBuilder>;
  private readonly validateSchema: boolean;
  private readonly featureFlags = getFeatureFlags();

  constructor(
    private readonly registry?: ConfigRegistry,
    options: TranslationEngineOptions = {}
  ) {
    this.customBuilders = options.customBuilders || new Map();
    this.validateSchema = options.validateSchema ?? false;

    // Log feature flag status for observability
    logFeatureFlagStatus('TranslationEngine');

    logger.info('translation-engine.initialized', {
      validateSchema: this.validateSchema,
      customBuilderCount: this.customBuilders.size,
      configRegistryProvided: !!registry,
      enableConfigRegistry: this.featureFlags.ENABLE_CONFIG_REGISTRY,
      enableGenericBuilder: this.featureFlags.ENABLE_GENERIC_BUILDER,
    });

    // Warn if registry not provided but flag is enabled
    if (this.featureFlags.ENABLE_CONFIG_REGISTRY && !registry) {
      logger.warn('translation-engine.config-registry-missing', {
        message: 'ENABLE_CONFIG_REGISTRY is true but no ConfigRegistry provided',
      });
    }
  }

  /**
   * Translate platform event to InternalEventV2
   *
   * Flow:
   * 1. Look up event mapping in ConfigRegistry
   * 2. Check for custom builder
   * 3. Use generic builder with field mapping
   * 4. Validate against schema (if enabled)
   *
   * @param platform - Platform name (e.g., 'discord', 'slack')
   * @param platformEvent - Platform event name (e.g., 'MESSAGE_CREATE')
   * @param eventPayload - Raw platform event payload
   * @param opts - Optional overrides
   * @returns Normalized InternalEventV2 envelope
   * @throws Error if no mapping found
   * @throws Error if validation fails
   *
   * @example
   * ```typescript
   * const envelope = await engine.translateInbound('discord', 'MESSAGE_CREATE', {
   *   channel: { type: 0, id: 'C123' },
   *   author: { id: 'U123', username: 'john' },
   *   content: 'Hello in channel'
   * });
   * ```
   */
  async translateInbound(
    platform: string,
    platformEvent: string,
    eventPayload: any,
    opts?: {
      uuid?: () => string;
      nowIso?: () => string;
      egressDestination?: string;
      correlationId?: string;
      [key: string]: any;
    }
  ): Promise<InternalEventV2> {
    logger.debug('translation-engine.translate-start', {
      platform,
      platformEvent,
    });

    let mapping: PlatformEventMapping | undefined;
    let eventType: string | undefined;

    // Step 1: Find event mapping from config registry (if enabled)
    if (this.featureFlags.ENABLE_CONFIG_REGISTRY && this.registry) {
      mapping = this.registry.findByPlatformEvent(platform, platformEvent, eventPayload);

      if (!mapping) {
        const error = new Error(`No event mapping found for ${platform}:${platformEvent}`);
        logger.error('translation-engine.no-mapping', {
          platform,
          platformEvent,
          error: error.message,
        });
        throw error;
      }

      eventType = mapping.internalEventType;

      logger.debug('translation-engine.mapping-found', {
        platform,
        platformEvent,
        internalEventType: eventType,
        priority: mapping.priority,
      });
    } else {
      // Config registry disabled - must use custom builders
      logger.debug('translation-engine.config-registry-disabled', {
        platform,
        platformEvent,
        message: 'Config registry disabled, checking for custom builder',
      });
    }

    // Step 2: Check for custom builder
    // Try with event type from mapping first, then try platform:platformEvent key
    const customBuilderKeys = eventType
      ? [`${platform}:${eventType}`, `${platform}:${platformEvent}`]
      : [`${platform}:${platformEvent}`];

    let customBuilder: CustomEnvelopeBuilder | undefined;
    let usedKey: string | undefined;

    for (const key of customBuilderKeys) {
      customBuilder = this.customBuilders.get(key);
      if (customBuilder) {
        usedKey = key;
        break;
      }
    }

    if (customBuilder) {
      logger.debug('translation-engine.using-custom-builder', {
        platform,
        eventType: eventType || platformEvent,
        builderKey: usedKey,
      });

      const envelope = customBuilder(eventPayload, opts);

      logger.info('translation-engine.translated', {
        platform,
        platformEvent,
        eventType: envelope.type,
        method: 'custom',
      });

      return envelope;
    }

    // Step 3: Use generic builder with field mapping (if enabled and mapping found)
    if (!this.featureFlags.ENABLE_GENERIC_BUILDER) {
      const error = new Error(
        `No custom builder registered for ${platform}:${platformEvent} and ENABLE_GENERIC_BUILDER=false`
      );
      logger.error('translation-engine.generic-builder-disabled', {
        platform,
        platformEvent,
        error: error.message,
      });
      throw error;
    }

    if (!mapping) {
      const error = new Error(
        `No mapping found for ${platform}:${platformEvent} and no custom builder registered`
      );
      logger.error('translation-engine.no-mapping-no-builder', {
        platform,
        platformEvent,
        error: error.message,
      });
      throw error;
    }

    logger.debug('translation-engine.using-generic-builder', {
      platform,
      eventType: mapping.internalEventType,
    });

    const eventDefinition = this.registry?.getEventDefinition(mapping.internalEventType);

    if (!eventDefinition) {
      const error = new Error(`Event definition not found for ${mapping.internalEventType}`);
      logger.error('translation-engine.no-event-definition', {
        eventType: mapping.internalEventType,
        error: error.message,
      });
      throw error;
    }

    const builderContext: GenericBuilderContext = {
      platform,
      eventType: mapping.internalEventType,
      platformEvent: eventPayload,
      fieldMapping: mapping.fieldMapping,
      opts,
    };

    const envelope = buildGenericEnvelope(builderContext);

    logger.info('translation-engine.translated', {
      platform,
      platformEvent,
      eventType: envelope.type,
      method: 'generic',
      correlationId: envelope.correlationId,
    });

    // Step 4: Validate against schema (if enabled)
    if (this.validateSchema) {
      await this.validateEvent(envelope, eventDefinition);
    }

    return envelope;
  }

  /**
   * Register custom builder for specific platform and event type
   *
   * @param platform - Platform name
   * @param eventType - Internal event type
   * @param builder - Custom builder function
   *
   * @example
   * ```typescript
   * engine.registerCustomBuilder('discord', 'chat.message.v1', buildDiscordEnvelope);
   * ```
   */
  registerCustomBuilder(
    platform: string,
    eventType: string,
    builder: CustomEnvelopeBuilder
  ): void {
    const key = `${platform}:${eventType}`;
    this.customBuilders.set(key, builder);

    logger.info('translation-engine.custom-builder-registered', {
      platform,
      eventType,
      key,
    });
  }

  /**
   * Validate event against JSON schema
   *
   * @param envelope - Event envelope to validate
   * @param eventDefinition - Event definition with schema
   * @throws Error if validation fails
   * @private
   */
  private async validateEvent(envelope: InternalEventV2, eventDefinition: any): Promise<void> {
    // TODO: Implement schema validation using Ajv
    // For now, just log that validation is enabled
    logger.debug('translation-engine.validation-skipped', {
      eventType: envelope.type,
      reason: 'not_implemented',
    });
  }
}

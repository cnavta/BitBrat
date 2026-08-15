/**
 * Egress Translator
 *
 * Translates InternalEventV2 events back to platform-specific payloads for outbound
 * message delivery. This is the inverse of the inbound translation pipeline.
 *
 * Architecture:
 * 1. Look up egress mapping in ConfigRegistry
 * 2. Extract fields from InternalEventV2 using field mapping
 * 3. Build platform-specific payload
 * 4. Return {method, payload} for connector execution
 *
 * Sprint 13: Bidirectional Translation (TE-001)
 *
 * @example
 * ```typescript
 * const translator = new EgressTranslator(registry);
 *
 * const result = translator.translateOutbound('discord', 'dm.message.v1', envelope);
 * // { method: 'sendDM', payload: { userId: '123', text: 'Hello!' } }
 * ```
 *
 * @since Sprint 13
 */

import type { InternalEventV2 } from '../../../types/events';
import type { ConfigRegistry } from './config-registry';
import { logger } from '../../../common/logging';
import _ from 'lodash';

/**
 * Egress field mapping value types
 *
 * Supports:
 * - string: Path extraction (e.g., 'message.text')
 * - object: Static value (e.g., { value: 'Markdown' })
 * - function: Custom extractor (future)
 */
export type EgressFieldValue =
  | string
  | {
      value?: any;
      path?: string;
      default?: any;
    };

/**
 * Egress field mapping configuration
 */
export interface EgressFieldMapping {
  [targetField: string]: EgressFieldValue;
}

/**
 * Egress mapping from YAML config
 */
export interface EgressMapping {
  method: string;
  fieldMapping: EgressFieldMapping;
}

/**
 * Translation result
 */
export interface EgressTranslationResult {
  /** Connector method to invoke (e.g., 'sendText', 'sendDM', 'sendReaction') */
  method: string;

  /** Platform-specific payload to pass to method */
  payload: Record<string, any>;
}

/**
 * Egress Translator
 *
 * Translates InternalEventV2 events to platform-specific payloads using
 * config-driven field mappings.
 *
 * Features:
 * - Path extraction using lodash _.get()
 * - Static value injection
 * - Default value fallbacks
 * - Graceful handling of missing fields
 *
 * @since Sprint 13
 */
export class EgressTranslator {
  constructor(private readonly registry: ConfigRegistry) {
    logger.info('egress-translator.initialized', {
      registryProvided: !!registry,
    });
  }

  /**
   * Translate InternalEventV2 to platform-specific payload
   *
   * Flow:
   * 1. Find egress mapping for platform + event type
   * 2. Extract fields from envelope using field mapping
   * 3. Build payload with extracted/static values
   * 4. Return {method, payload}
   *
   * @param platform - Platform name (e.g., 'discord', 'slack')
   * @param eventType - Internal event type (e.g., 'dm.message.v1')
   * @param envelope - InternalEventV2 envelope to translate
   * @returns Translation result with method and payload
   * @throws Error if no egress mapping found
   *
   * @example
   * ```typescript
   * const result = translator.translateOutbound('discord', 'dm.message.v1', {
   *   message: { text: 'Hello!' },
   *   identity: { external: { id: 'U123' } }
   * });
   * // { method: 'sendDM', payload: { userId: 'U123', text: 'Hello!' } }
   * ```
   */
  translateOutbound(
    platform: string,
    eventType: string,
    envelope: InternalEventV2
  ): EgressTranslationResult {
    logger.debug('egress-translator.translate-start', {
      platform,
      eventType,
    });

    // Step 1: Find egress mapping
    const mapping = this.findEgressMapping(platform, eventType);

    if (!mapping) {
      const error = new Error(
        `No egress mapping found for ${platform}:${eventType}`
      );
      logger.error('egress-translator.no-mapping', {
        platform,
        eventType,
        error: error.message,
      });
      throw error;
    }

    // Step 2: Extract method name
    const method = mapping.method || 'sendText';

    // Step 3: Build payload from field mapping
    const payload = this.buildPayload(envelope, mapping.fieldMapping);

    logger.info('egress-translator.translated', {
      platform,
      eventType,
      method,
      fieldCount: Object.keys(payload).length,
    });

    return { method, payload };
  }

  /**
   * Find egress mapping for platform and event type
   *
   * Searches ConfigRegistry for platform mapping with egress configuration.
   *
   * @param platform - Platform name
   * @param eventType - Internal event type
   * @returns Egress mapping or null if not found
   * @private
   */
  private findEgressMapping(
    platform: string,
    eventType: string
  ): EgressMapping | null {
    // Access internal platformMappings map
    const platformMappings = (this.registry as any).platformMappings.get(platform);

    if (!platformMappings) {
      logger.debug('egress-translator.no-platform', { platform });
      return null;
    }

    // Find mapping with matching event type and egress config
    const mapping = platformMappings.find(
      (m: any) => m.internalEventType === eventType && m.egress
    );

    if (!mapping) {
      logger.debug('egress-translator.no-event-mapping', {
        platform,
        eventType,
      });
      return null;
    }

    return mapping.egress as EgressMapping;
  }

  /**
   * Build platform payload from field mapping
   *
   * Supports:
   * - Path extraction: 'message.text' → _.get(envelope, 'message.text')
   * - Static values: { value: 'Markdown' } → 'Markdown'
   * - Default fallbacks: { path: 'message.text', default: '' } → '' if missing
   *
   * @param envelope - InternalEventV2 envelope
   * @param fieldMapping - Field mapping configuration
   * @returns Platform-specific payload
   * @private
   */
  private buildPayload(
    envelope: InternalEventV2,
    fieldMapping: EgressFieldMapping
  ): Record<string, any> {
    const payload: Record<string, any> = {};

    for (const [targetField, mapping] of Object.entries(fieldMapping)) {
      const value = this.extractFieldValue(envelope, mapping);

      // Only include field if value is defined
      if (value !== undefined) {
        payload[targetField] = value;
      }
    }

    return payload;
  }

  /**
   * Extract field value from envelope
   *
   * Handles three mapping types:
   * 1. String path: Extract using lodash _.get()
   * 2. Static value: Return { value } directly
   * 3. Path with default: Extract or return default
   *
   * @param envelope - InternalEventV2 envelope
   * @param mapping - Field mapping configuration
   * @returns Extracted value or undefined
   * @private
   */
  private extractFieldValue(
    envelope: InternalEventV2,
    mapping: EgressFieldValue
  ): any {
    // Type 1: String path (e.g., 'message.text')
    if (typeof mapping === 'string') {
      return _.get(envelope, mapping);
    }

    // Type 2: Object with static value or path
    if (typeof mapping === 'object') {
      // Static value: { value: 'Markdown' }
      if ('value' in mapping && mapping.value !== undefined) {
        return mapping.value;
      }

      // Path with optional default: { path: 'message.text', default: '' }
      if ('path' in mapping && mapping.path) {
        const value = _.get(envelope, mapping.path);
        return value !== undefined ? value : mapping.default;
      }

      // Default fallback: { default: 'fallback' }
      if ('default' in mapping) {
        return mapping.default;
      }
    }

    return undefined;
  }
}

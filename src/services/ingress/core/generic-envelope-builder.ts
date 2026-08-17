/**
 * Generic Envelope Builder
 *
 * SINGLE universal builder that works for ALL platforms - eliminates platform-specific default builders.
 *
 * Key Innovation: Instead of creating platform-specific builders for every event type,
 * this generic builder uses declarative field mappings to extract data from any platform event.
 *
 * **When to use**:
 * - 90% of event types (simple field extraction)
 * - Message events, typing indicators, presence updates, reactions, DMs, etc.
 *
 * **When NOT to use** (use custom builder instead):
 * - Multi-parameter events (e.g., voice state changes with oldState, newState)
 * - Complex data transformations
 * - Events requiring conditional logic beyond simple filtering
 *
 * Sprint 13: DM Capability Implementation (EP-01: Developer Experience Foundation)
 *
 * @example
 * ```typescript
 * // Discord message - no platform-specific builder needed
 * const envelope = buildGenericEnvelope({
 *   platform: 'discord',
 *   eventType: 'typing.start.v1',
 *   platformEvent: discordTypingEvent,
 *   fieldMapping: {
 *     userId: 'user.id',
 *     userName: {
 *       path: 'user.username',
 *       fallbacks: ['user.globalName', 'user.id']
 *     },
 *     channelId: 'channel.id'
 *   }
 * });
 * ```
 *
 * @example Slack with event wrapper
 * ```typescript
 * const envelope = buildGenericEnvelope({
 *   platform: 'slack',
 *   eventType: 'chat.message.v1',
 *   platformEvent: slackPayload,
 *   fieldMapping: {
 *     eventWrapper: 'event',  // Slack nests events
 *     userId: 'user',
 *     channelId: 'channel',
 *     messageText: 'text',
 *     messageId: 'ts'
 *   }
 * });
 * ```
 *
 * @since Sprint 13
 */

import type { InternalEventV2, DebugMetadata, ConnectorType } from '../../../types/events';
import { randomUUID } from 'crypto';
import _ from 'lodash';

/**
 * Field mapping configuration for generic builder
 *
 * Supports both simple path strings and objects with fallback paths.
 */
export interface GenericFieldMapping {
  /**
   * Event wrapper path (e.g., 'event' for Slack which nests events)
   *
   * When specified, the builder extracts this field first and uses it as the base object.
   */
  eventWrapper?: string;

  /** User ID extraction (required) */
  userId: string | ((evt: any) => string);

  /** Channel ID extraction (required) */
  channelId: string | ((evt: any) => string);

  /**
   * User name extraction with fallback paths
   *
   * Example: Discord userName can fallback from username → globalName → id
   */
  userName?:
    | string
    | ((evt: any) => string)
    | {
        path?: string | ((evt: any) => string);
        fallbacks?: string[];
      };

  /** Message text extraction */
  messageText?:
    | string
    | ((evt: any) => string)
    | {
        path?: string | ((evt: any) => string);
        fallbacks?: string[];
      };

  /** Message ID extraction */
  messageId?:
    | string
    | ((evt: any) => string)
    | {
        path?: string | ((evt: any) => string);
        fallbacks?: string[];
      };

  /** Timestamp extraction */
  timestamp?:
    | string
    | ((evt: any) => string)
    | {
        path?: string | ((evt: any) => string);
        fallbacks?: string[];
      };

  /**
   * Custom fields for event-specific data
   *
   * Example: { isDM: () => true, guildId: 'guild.id' }
   */
  custom?: Record<string, string | ((evt: any) => any)>;
}

/**
 * Context for generic envelope builder
 */
export interface GenericBuilderContext {
  /** Platform name (e.g., 'discord', 'slack', 'twitch') */
  platform: string;

  /** Internal event type (e.g., 'chat.message.v1', 'dm.message.v1') */
  eventType: string;

  /** Raw platform event payload */
  platformEvent: any;

  /** Field mapping configuration */
  fieldMapping: GenericFieldMapping;

  /** Optional overrides for testing */
  opts?: {
    uuid?: () => string;
    nowIso?: () => string;
    egressDestination?: string;
    correlationId?: string;
    debugMetadata?: DebugMetadata;
  };
}

/**
 * Build generic envelope from platform event
 *
 * This is the SINGLE universal builder for ALL platforms. It uses declarative
 * field mappings to extract data from any platform event and constructs a
 * normalized InternalEventV2.
 *
 * @param ctx - Builder context with platform event and field mapping
 * @returns Normalized InternalEventV2 event
 */
export function buildGenericEnvelope(ctx: GenericBuilderContext): InternalEventV2 {
  const { platform, eventType, platformEvent, fieldMapping, opts } = ctx;

  const uuid = opts?.uuid || randomUUID;
  const nowIso = opts?.nowIso || (() => new Date().toISOString());
  const correlationId = opts?.correlationId || uuid();
  const traceId = uuid();

  // Handle platform-specific event wrappers (e.g., Slack nests events under 'event')
  const evt = fieldMapping.eventWrapper
    ? _.get(platformEvent, fieldMapping.eventWrapper) || platformEvent
    : platformEvent;

  // Extract required fields
  const userId = extractWithFallbacks(evt, fieldMapping.userId);
  const channelId = extractWithFallbacks(evt, fieldMapping.channelId);

  if (!userId || !channelId) {
    throw new Error(
      `generic-envelope-builder.missing_required_fields: userId=${userId}, channelId=${channelId}`
    );
  }

  // Extract optional fields with fallbacks
  const userName = extractWithFallbacks(evt, fieldMapping.userName) || userId;
  const messageText = extractWithFallbacks(evt, fieldMapping.messageText);
  const messageId = extractWithFallbacks(evt, fieldMapping.messageId);
  const timestamp = extractWithFallbacks(evt, fieldMapping.timestamp) || nowIso();

  // Extract custom fields
  const customFields = fieldMapping.custom ? extractCustomFields(evt, fieldMapping.custom) : {};

  // Detect platform event name for metadata
  const platformEventName = extractPlatformEventName(platformEvent, platform);

  // Build normalized envelope
  const envelope: InternalEventV2 = {
    v: '2',
    type: eventType,
    correlationId,
    traceId,

    ingress: {
      ingressAt: nowIso(),
      source: `ingress.${platform}`,
      connector: platform as ConnectorType,
      channel: channelId,
    },

    identity: {
      external: {
        id: userId,
        platform,
        displayName: userName,
        metadata: customFields.identity || {},
      },
    },

    egress: {
      destination: opts?.egressDestination || '',
      type: determineEgressType(eventType),
      connector: platform as ConnectorType,
      channel: channelId,
    },

    routing: {
      stage: 'initial',
      slip: [],
      history: [],
    },

    metadata: {
      rawPlatformPayload: platformEvent,
      platformEventName,
    },
  };

  // Add message field if we have text or ID
  if (messageText || messageId) {
    envelope.message = {
      id: messageId || `msg-${correlationId}`,
      role: 'user',
      text: messageText || '',
      rawPlatformPayload: evt,
    };
  }

  // Merge custom fields at root level (for event-specific data)
  Object.assign(envelope, customFields.root || {});

  // Attach debug metadata if provided
  if (opts?.debugMetadata) {
    envelope.qos = {
      tracer: true, // Enable high-verbosity tracing
    };
    envelope.metadata = {
      ...envelope.metadata,
      debug: opts.debugMetadata,
    };
  }

  return envelope;
}

/**
 * Extract field using path/function with optional fallback paths
 *
 * Handles three input types:
 * 1. Function: (evt) => evt.user.id
 * 2. String path: 'user.id'
 * 3. Object with fallbacks: { path: 'user.username', fallbacks: ['user.globalName', 'user.id'] }
 *
 * @param obj - Object to extract from
 * @param mapping - Field mapping configuration
 * @returns Extracted value as string, or empty string if not found
 */
function extractWithFallbacks(
  obj: any,
  mapping:
    | string
    | {
        path?: string | ((obj: any) => any);
        fallbacks?: string[];
      }
    | ((obj: any) => any)
    | undefined
): string {
  if (!mapping) return '';

  // Direct function
  if (typeof mapping === 'function') {
    const result = mapping(obj);
    return result !== undefined && result !== null ? String(result) : '';
  }

  // Direct path string
  if (typeof mapping === 'string') {
    const result = _.get(obj, mapping);
    return result !== undefined && result !== null ? String(result) : '';
  }

  // Object with path and fallbacks
  if (typeof mapping === 'object') {
    // Try primary path
    if (mapping.path) {
      const primary =
        typeof mapping.path === 'function' ? mapping.path(obj) : _.get(obj, mapping.path);
      if (primary !== undefined && primary !== null) {
        return String(primary);
      }
    }

    // Try fallback paths
    if (mapping.fallbacks) {
      for (const fallback of mapping.fallbacks) {
        const value = _.get(obj, fallback);
        if (value !== undefined && value !== null) {
          return String(value);
        }
      }
    }
  }

  return '';
}

/**
 * Extract custom fields from event
 *
 * Custom fields can be organized into:
 * - root: Fields added at the envelope root level
 * - identity: Fields added to identity.external.metadata
 *
 * @param obj - Object to extract from
 * @param custom - Custom field mappings
 * @returns Extracted custom fields
 */
function extractCustomFields(
  obj: any,
  custom: Record<string, string | ((obj: any) => any)>
): { root?: any; identity?: any } {
  const result: any = {};

  for (const [key, extractor] of Object.entries(custom)) {
    let value: any;
    if (typeof extractor === 'function') {
      value = extractor(obj);
    } else {
      value = _.get(obj, extractor);
    }

    // Organize fields by namespace
    if (key.startsWith('identity.')) {
      const fieldName = key.replace('identity.', '');
      result.identity = result.identity || {};
      result.identity[fieldName] = value;
    } else {
      result.root = result.root || {};
      result.root[key] = value;
    }
  }

  return result;
}

/**
 * Extract platform event name for metadata
 *
 * Platform-specific logic to detect what type of event this is on the platform.
 * Used for observability and debugging.
 *
 * @param evt - Platform event
 * @param platform - Platform name
 * @returns Platform event name
 */
function extractPlatformEventName(evt: any, platform: string): string {
  switch (platform) {
    case 'discord':
      return evt.constructor?.name || evt.t || 'DiscordEvent';
    case 'slack':
      return evt.event?.type || evt.type || 'SlackEvent';
    case 'twitch':
      return 'subscription' in evt ? 'EventSub' : 'IRC';
    case 'telegram':
      return Object.keys(evt).find((k) => k !== 'update_id') || 'TelegramUpdate';
    default:
      return 'UnknownEvent';
  }
}

/**
 * Determine egress type based on event type
 *
 * Maps internal event types to egress types for routing.
 *
 * @param eventType - Internal event type (e.g., 'dm.message.v1', 'chat.message.v1')
 * @returns Egress type ('dm', 'chat', or 'event')
 */
function determineEgressType(eventType: string): 'dm' | 'chat' | 'event' {
  if (eventType.startsWith('dm.')) {
    return 'dm';
  } else if (eventType.startsWith('chat.')) {
    return 'chat';
  }
  return 'event';
}

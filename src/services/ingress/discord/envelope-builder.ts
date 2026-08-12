/**
 * Discord Envelope Builder
 *
 * Normalizes Discord events to BitBrat's Envelope v1 format.
 *
 * Supported event types:
 * - message: Guild (server) messages
 * - dm: Direct messages
 *
 * Sprint 11: Discord Integration Modernization
 *
 * @since Sprint 11
 */

import type { InternalEventV2, DebugMetadata } from '../../../types/events';
import { randomUUID } from 'crypto';

/**
 * Discord message metadata
 *
 * Extracted from Discord.js Message object.
 */
export interface DiscordMessageMeta {
  guildId: string;
  channelId: string;
  messageId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt?: string;
  mentions?: string[];
  roles?: string[];
  isOwner?: boolean;
  raw?: Record<string, unknown>;
}

/**
 * Build Envelope v1 from Discord event
 *
 * @param event - Discord message metadata
 * @param opts - Optional overrides for testing
 * @param opts.uuid - UUID generator function (for testing)
 * @param opts.nowIso - ISO timestamp generator function (for testing)
 * @param opts.egressDestination - Egress destination topic override
 * @param opts.correlationId - Pre-generated correlation ID (for debug mode)
 * @param opts.debugMetadata - Debug metadata (when authorized user activates debug mode)
 * @returns Envelope v1 event
 *
 * @example
 * ```typescript
 * const envelope = buildDiscordEnvelope({
 *   guildId: '123456789',
 *   channelId: '987654321',
 *   messageId: '111222333',
 *   authorId: 'U123456',
 *   authorName: 'john_doe',
 *   content: 'Hello, world!'
 * });
 * ```
 *
 * @example Debug mode
 * ```typescript
 * const envelope = buildDiscordEnvelope(
 *   {
 *     guildId: '123',
 *     channelId: '456',
 *     messageId: '789',
 *     authorId: 'U123',
 *     authorName: 'user',
 *     content: 'test'
 *   },
 *   {
 *     debugMetadata: {
 *       enabled: true,
 *       initiatedBy: 'U123',
 *       feedbackChannel: '456',
 *       startedAt: new Date().toISOString()
 *     }
 *   }
 * );
 * ```
 */
export function buildDiscordEnvelope(
  event: DiscordMessageMeta,
  opts?: {
    uuid?: () => string;
    nowIso?: () => string;
    egressDestination?: string;
    correlationId?: string;
    debugMetadata?: DebugMetadata;
  }
): InternalEventV2 {
  const uuid = opts?.uuid || randomUUID;
  const nowIso = opts?.nowIso || (() => new Date().toISOString());

  // Use provided correlationId (for debug mode) or generate new one
  const correlationId = opts?.correlationId || uuid();
  const traceId = uuid();

  // Build base envelope
  const envelope: InternalEventV2 = {
    v: '2',
    type: 'chat.message.v1',
    correlationId,
    traceId,
    ingress: {
      ingressAt: nowIso(),
      source: 'ingress.discord',
      connector: 'discord',
      channel: event.channelId,
    },
    identity: {
      external: {
        id: event.authorId,
        platform: 'discord',
        displayName: event.authorName,
        metadata: {
          guildId: event.guildId,
          roles: event.roles || [],
          isOwner: !!event.isOwner,
        }
      }
    },
    egress: {
      destination: opts?.egressDestination || '',
      type: 'chat',
      connector: 'discord',
      channel: event.channelId
    },
    message: {
      id: event.messageId || `msg-${correlationId}`,
      role: 'user',
      text: event.content,
      rawPlatformPayload: {
        content: event.content,
        guildId: event.guildId,
        channelId: event.channelId,
        authorId: event.authorId,
        authorName: event.authorName,
        mentions: event.mentions || [],
        roles: event.roles || [],
        isOwner: !!event.isOwner,
        timestamp: event.createdAt || nowIso(),
      },
    },
    annotations: [
      {
        id: uuid(),
        kind: 'custom',
        source: 'discord',
        createdAt: nowIso(),
        label: 'source',
        payload: {
          guildId: event.guildId,
          channelId: event.channelId,
          authorName: event.authorName,
        },
      },
    ],
    routing: {
      stage: 'initial',
      slip: [],
      history: [],
    }
  };

  // Attach debug metadata if provided
  if (opts?.debugMetadata) {
    envelope.qos = {
      tracer: true, // Enable high-verbosity tracing
    };
    envelope.metadata = {
      debug: opts.debugMetadata,
    };
  }

  return envelope;
}

/**
 * Legacy envelope builder class (backward compatibility)
 *
 * @deprecated Use buildDiscordEnvelope function instead
 *
 * This class provides backward compatibility for code that expects
 * the EnvelopeBuilder interface. It delegates to the functional
 * buildDiscordEnvelope implementation.
 *
 * Will be removed in DISC-004 when DiscordIngressClient is refactored
 * to accept the functional builder directly.
 */
export class DiscordEnvelopeBuilder {
  build(
    meta: DiscordMessageMeta,
    opts?: {
      uuid?: () => string;
      nowIso?: () => string;
      egressDestination?: string;
      correlationId?: string;
      debugMetadata?: DebugMetadata;
    }
  ): InternalEventV2 {
    return buildDiscordEnvelope(meta, opts);
  }
}

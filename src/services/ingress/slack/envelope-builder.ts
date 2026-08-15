/**
 * Slack Envelope Builder
 *
 * Normalizes Slack events to BitBrat's Envelope v1 format.
 *
 * Supported event types:
 * - message.channels: Public channel messages
 * - message.groups: Private channel messages
 * - message.im: Direct messages
 * - app_mention: @mentions of the bot
 * - reaction_added: Reactions to messages
 *
 * Sprint 348: Slack Integration
 *
 * @since Sprint 348
 */

import type { InternalEventV2, DebugMetadata } from '../../../types/events';
import { randomUUID } from 'crypto';

/**
 * Slack event metadata
 *
 * Extracted from Slack Events API event payload.
 */
export interface SlackEventMeta {
  type: string;
  user?: string;
  channel?: string;
  text?: string;
  ts?: string; // Message timestamp (unique ID)
  thread_ts?: string; // Thread parent timestamp
  team?: string; // Workspace ID
  event_ts?: string; // Event timestamp
}

/**
 * Build Envelope v1 from Slack event
 *
 * @param event - Slack event metadata
 * @param opts - Optional overrides for testing
 * @param opts.debugMetadata - Sprint 371: Debug metadata (when authorized user activates debug mode)
 * @returns Envelope v1 event
 *
 * @example
 * ```typescript
 * const envelope = buildSlackEnvelope({
 *   type: 'message',
 *   user: 'U123456',
 *   channel: 'C123456',
 *   text: 'Hello, world!',
 *   ts: '1234567890.123456'
 * });
 * ```
 *
 * @example Debug mode
 * ```typescript
 * const envelope = buildSlackEnvelope(
 *   { type: 'message', user: 'U123', channel: 'C456', text: 'test', ts: '123.456' },
 *   {
 *     debugMetadata: {
 *       enabled: true,
 *       initiatedBy: 'U123',
 *       feedbackChannel: 'C456',
 *       startedAt: new Date().toISOString()
 *     }
 *   }
 * );
 * ```
 */
export function buildSlackEnvelope(
  event: SlackEventMeta,
  opts?: {
    uuid?: () => string;
    nowIso?: () => string;
    egressDestination?: string; // Egress topic for routing responses back
    correlationId?: string; // Sprint 371: Pre-generated correlation ID for debug mode
    debugMetadata?: DebugMetadata; // Sprint 371: Debug metadata
  }
): InternalEventV2 {
  const uuid = opts?.uuid || randomUUID;
  const nowIso = opts?.nowIso || (() => new Date().toISOString());

  // Sprint 371: Use provided correlationId (for debug mode) or generate new one
  const correlationId = opts?.correlationId || uuid();
  const traceId = uuid();

  const userId = event.user || 'unknown';
  const channelId = event.channel || 'unknown';

  // Sprint 13: Detect DM channel (channel ID starts with 'D')
  const isDM = channelId.startsWith('D');
  const eventType = isDM ? 'dm.message.v1' : 'chat.message.v1';
  const egressType = isDM ? 'dm' : 'chat';

  // Sprint 371: Build base envelope
  const envelope: InternalEventV2 = {
    v: '2',
    type: eventType,
    correlationId,
    traceId,
    ingress: {
      ingressAt: nowIso(),
      source: 'ingress.slack',
      connector: 'slack',
      channel: channelId,
    },
    identity: {
      external: {
        id: userId,
        platform: 'slack',
        displayName: userId, // TODO: Resolve display name in SLACK-005
        metadata: {
          channelId,
          teamId: event.team,
          threadTs: event.thread_ts,
        }
      }
    },
    egress: {
      destination: opts?.egressDestination || '',
      type: egressType,
      connector: 'slack',
      channel: channelId,
    },
    message: {
      id: event.ts || `msg-${correlationId}`,
      role: 'user',
      text: event.text || '',
      rawPlatformPayload: {
        type: event.type,
        user: event.user,
        channel: event.channel,
        text: event.text,
        ts: event.ts,
        thread_ts: event.thread_ts,
        team: event.team,
        event_ts: event.event_ts,
      },
    },
    routing: {
      stage: 'initial',
      slip: [],
      history: [],
    }
  };

  // Sprint 371: Attach debug metadata if provided
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

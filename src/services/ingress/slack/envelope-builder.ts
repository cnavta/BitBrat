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

import type { InternalEventV2 } from '../../../types/events';
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
 */
export function buildSlackEnvelope(
  event: SlackEventMeta,
  opts?: {
    uuid?: () => string;
    nowIso?: () => string;
  }
): InternalEventV2 {
  const uuid = opts?.uuid || randomUUID;
  const nowIso = opts?.nowIso || (() => new Date().toISOString());

  const correlationId = uuid();
  const traceId = uuid();

  const userId = event.user || 'unknown';
  const channelId = event.channel || 'unknown';

  return {
    v: '2',
    type: 'chat.message.v1',
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
      destination: '',
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
}

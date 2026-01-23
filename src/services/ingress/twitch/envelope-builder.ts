import { InternalEventV2 } from '../../../types/events';
import crypto from 'crypto';

/**
 * EnvelopeBuilder — Twitch IRC
 * llm_prompt: Provide a transport-neutral mapping interface from IRC message metadata to InternalEventV2.
 *
 * This scaffolding defines the types and contract only (INEG-01). No side effects.
 */

/** Minimal shape of a parsed IRC message we care about at ingress time. */
export interface IrcMessageMeta {
  channel: string;           // e.g., #mychannel (may be provided without '#')
  userLogin: string;         // lowercased login
  userDisplayName?: string;
  userId?: string;
  roomId?: string;           // channel id if available from tags
  messageId?: string;        // IRC message id
  text: string;              // message text
  color?: string;            // hex color
  badges?: string[];         // simplified badges list
  isMod?: boolean;
  isSubscriber?: boolean;
  emotes?: Array<{ id: string; start: number; end: number }>; // optional emote positions
  raw?: Record<string, any>; // raw tags or metadata for debugging
}

/** Options to influence envelope construction. */
export interface EnvelopeBuilderOptions {
  /** Optional override for finalization topic. */
  finalizationDestination?: string;
  /** Optional function to generate UUIDs; defaults to crypto.randomUUID */
  uuid?: () => string;
  /** Optional timestamp supplier for testability; defaults to new Date().toISOString() */
  nowIso?: () => string;
}

/**
 * Contract for transforming an IRC message into an InternalEventV2 (flattened envelope).
 */
export interface IEnvelopeBuilder {
  build(msg: IrcMessageMeta, opts?: EnvelopeBuilderOptions): InternalEventV2;
}

/**
 * NoopEnvelopeBuilder — placeholder implementation that throws until INEG-02.
 */
export class NoopEnvelopeBuilder implements IEnvelopeBuilder {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  build(_msg: IrcMessageMeta, _opts?: EnvelopeBuilderOptions): InternalEventV2 {
    throw new Error('EnvelopeBuilder not implemented yet (INEG-02)');
  }
}

/**
 * TwitchEnvelopeBuilder — builds InternalEventV2 for chat messages.
 * Implementation aligned with src/types/events.ts contracts.
 */
export class TwitchEnvelopeBuilder implements IEnvelopeBuilder {
  build(msg: IrcMessageMeta, opts?: EnvelopeBuilderOptions): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());

    const channel = msg.channel.startsWith('#') ? msg.channel : `#${msg.channel}`;
    const correlationId = uuid();
    const traceId = uuid();

    const evt: InternalEventV2 = {
      v: '1',
      source: 'ingress.twitch',
      correlationId,
      traceId,
      routingSlip: [],
      egress: { destination: '' }, // populated by client
      type: 'chat.message.v1',
      channel,
      userId: msg.userId,
      message: {
        id: msg.messageId || `msg-${correlationId}`,
        role: 'user',
        text: msg.text,
        rawPlatformPayload: {
          text: msg.text,
          messageId: msg.messageId || '',
          user: {
            login: msg.userLogin,
            displayName: msg.userDisplayName || msg.userLogin,
          },
          roomId: msg.roomId || '',
          color: msg.color,
          badges: msg.badges || [],
          isMod: !!msg.isMod,
          isSubscriber: !!msg.isSubscriber,
          emotes: msg.emotes || [],
          raw: msg.raw || {},
          timestamp: nowIso(),
        },
      },
    };
    return evt;
  }
}

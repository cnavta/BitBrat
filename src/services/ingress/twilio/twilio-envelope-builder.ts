import { InternalEventV2 } from '../../../types/events';
import crypto from 'crypto';

/**
 * Minimal interface for Twilio Conversations Message to avoid direct SDK dependency in builder if desired,
 * but typically we use the SDK type.
 */
export interface TwilioMessageLike {
  sid: string;
  author: string | null;
  body: string | null;
  dateCreated: Date | null;
  conversation: {
    sid: string;
  };
}

export class TwilioEnvelopeBuilder {
  /**
   * Transforms a Twilio message into the platform's standard InternalEventV2.
   */
  build(message: TwilioMessageLike, opts?: { uuid?: () => string, nowIso?: () => string }): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());

    const correlationId = uuid();
    const traceId = uuid();

    // Mapping Twilio identity (phone number or identity) to platform userId
    const author = message.author || 'unknown';
    const conversationSid = message.conversation.sid;

    return {
      v: '1',
      source: 'ingress.twilio',
      correlationId,
      traceId,
      routingSlip: [],
      type: 'chat.message.v1',
      channel: conversationSid,
      userId: author,
      message: {
        id: message.sid || `msg-${correlationId}`,
        role: 'user',
        text: message.body || '',
        rawPlatformPayload: {
          text: message.body || '',
          messageId: message.sid,
          author: author,
          conversationSid: conversationSid,
          timestamp: message.dateCreated?.toISOString() || nowIso(),
          // We don't include the full message object to avoid circular dependencies or non-serializable data
        },
      },
    };
  }
}

import crypto from 'crypto';
import type { EnvelopeBuilder } from '../core';
import type { InternalEventV2 } from '../../../types/events';

export interface TwilioMessageMeta {
  sid: string;
  conversationSid: string;
  author: string;
  body: string | null;
  dateCreated: Date | null;
  attributes: Record<string, any>;
}

export class SmsEnvelopeBuilder implements EnvelopeBuilder<TwilioMessageMeta> {
  build(
    meta: TwilioMessageMeta,
    opts?: { uuid?: () => string; nowIso?: () => string; egressDestination?: string }
  ): InternalEventV2 {
    const uuid = opts?.uuid || (() => crypto.randomUUID());
    const nowIso = opts?.nowIso || (() => new Date().toISOString());

    const correlationId = uuid();
    const traceId = uuid();

    const evt: InternalEventV2 = {
      v: '1',
      source: 'ingress.twilio.sms',
      correlationId,
      traceId,
      routingSlip: [],
      egressDestination: opts?.egressDestination,
      type: 'chat.message.v1',
      channel: meta.conversationSid,
      userId: meta.author,
      message: {
        id: meta.sid,
        role: 'user',
        text: meta.body || '',
        rawPlatformPayload: {
          sid: meta.sid,
          conversationSid: meta.conversationSid,
          author: meta.author,
          body: meta.body,
          dateCreated: meta.dateCreated?.toISOString() || nowIso(),
          attributes: meta.attributes,
        },
      },
      annotations: [
        {
          id: uuid(),
          kind: 'custom',
          source: 'twilio',
          createdAt: nowIso(),
          label: 'source',
          payload: {
            conversationSid: meta.conversationSid,
            author: meta.author,
          },
        },
      ],
    };
    return evt;
  }
}

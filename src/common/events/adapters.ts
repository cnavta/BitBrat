import {
  EnvelopeV1,
  InternalEventV1,
  InternalEventV2,
  InternalEventType,
} from '../../types/events';

export function toV1(evt: InternalEventV2): InternalEventV1 {
  const envelope: EnvelopeV1 = {
    v: '1',
    source: evt.source,
    correlationId: evt.correlationId,
    traceId: evt.traceId,
    replyTo: evt.replyTo,
    timeoutAt: evt.timeoutAt,
    egress: evt.egress,
    routingSlip: evt.routingSlip,
    user: evt.user,
    auth: evt.auth,
  } as EnvelopeV1;
  return {
    envelope,
    type: evt.type as InternalEventType,
    channel: evt.channel,
    userId: evt.userId,
    // Represent V2 message minimally as payload for legacy evaluators
    payload: {
      message: evt.message,
      annotations: evt.annotations,
      candidates: evt.candidates,
      errors: evt.errors,
    },
  };
}

export function toV2(evt: InternalEventV1): InternalEventV2 {
  const base: InternalEventV2 = {
    v: '1',
    source: evt.envelope.source,
    correlationId: evt.envelope.correlationId,
    traceId: evt.envelope.traceId,
    replyTo: evt.envelope.replyTo,
    timeoutAt: evt.envelope.timeoutAt,
    egress: evt.envelope.egress,
    routingSlip: evt.envelope.routingSlip,
    user: evt.envelope.user,
    auth: evt.envelope.auth,
    type: evt.type,
    channel: evt.channel,
    userId: evt.userId,
    message: {
      id: (evt.payload as any)?.messageId || (evt.payload as any)?.id || 'msg-' + (evt.envelope.correlationId || '0'),
      role: 'user',
      text: (evt.payload as any)?.chat?.text ?? (evt.payload as any)?.text,
      language: (evt.payload as any)?.language,
      rawPlatformPayload: evt.payload,
    },
  };
  return base;
}

export function busAttrsFromEvent(evt: InternalEventV2): Record<string, string> {
  const attrs: Record<string, string> = {
    type: evt.type,
    source: evt.source,
    correlationId: evt.correlationId,
  };
  if (evt.traceId) attrs.traceId = evt.traceId;
  return attrs;
}

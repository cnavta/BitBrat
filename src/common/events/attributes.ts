import { InternalEventV2 } from '../../types/events';
import type { AttributeMap } from '../../services/message-bus';

/** Derive transport attributes from an InternalEventV2. */
export function busAttrsFromEvent(evt: InternalEventV2): AttributeMap {
  const attrs: AttributeMap = {
    type: String(evt?.type || ''),
  } as AttributeMap;
  if (evt?.correlationId) attrs.correlationId = String(evt.correlationId);
  // Provide an explicit idempotency key for at-least-once delivery dedupe. Default to correlationId.
  if (evt?.correlationId) attrs.idempotencyKey = String(evt.correlationId);
  if (evt?.ingress?.source) attrs.source = String(evt.ingress.source);
  if (evt?.traceId) attrs.traceId = String(evt.traceId);
  if (evt?.ingress?.channel) attrs.channel = String(evt.ingress.channel);
  return attrs;
}

export default { busAttrsFromEvent };

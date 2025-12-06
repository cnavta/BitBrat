import { InternalEventV2 } from '../../types/events';
import type { AttributeMap } from '../../services/message-bus';

/** Derive transport attributes from an InternalEventV2. */
export function busAttrsFromEvent(evt: InternalEventV2): AttributeMap {
  const attrs: AttributeMap = {
    type: String(evt?.type || ''),
  } as AttributeMap;
  if ((evt as any)?.correlationId) attrs.correlationId = String((evt as any).correlationId);
  // Provide an explicit idempotency key for at-least-once delivery dedupe. Default to correlationId.
  if ((evt as any)?.correlationId) attrs.idempotencyKey = String((evt as any).correlationId);
  if ((evt as any)?.source) attrs.source = String((evt as any).source);
  if ((evt as any)?.traceId) attrs.traceId = String((evt as any).traceId);
  if ((evt as any)?.channel) attrs.channel = String((evt as any).channel);
  return attrs;
}

export default { busAttrsFromEvent };

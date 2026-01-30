import {
  InternalEventV2,
} from '../../types/events';

export function busAttrsFromEvent(evt: InternalEventV2): Record<string, string> {
  const attrs: Record<string, string> = {
    type: evt.type,
    source: evt.ingress.source,
    correlationId: evt.correlationId,
  };
  if (evt.traceId) attrs.traceId = evt.traceId;
  return attrs;
}

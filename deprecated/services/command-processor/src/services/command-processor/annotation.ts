import { AnnotationV1, InternalEventV2 } from '../../types/events';
import { randomUUID } from 'node:crypto';

/** Create an annotation with default fields. */
export function createAnnotation(kind: string, label?: string, value?: string, payload?: Record<string, any>): AnnotationV1 {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    kind: (kind || 'custom') as any,
    source: 'command-processor',
    createdAt: now,
    label,
    value,
    payload,
  };
}

/** Append an annotation to the event, creating the annotations array if needed. */
export function appendAnnotation(evt: InternalEventV2, ann: AnnotationV1): AnnotationV1 {
  if (!Array.isArray(evt.annotations)) evt.annotations = [];
  evt.annotations.push(ann);
  return ann;
}

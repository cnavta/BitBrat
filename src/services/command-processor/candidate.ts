import { CandidateV1, InternalEventV2 } from '../../types/events';
import { randomUUID } from 'node:crypto';

/** Create a text candidate with default fields. */
export function createTextCandidate(text: string, metadata?: Record<string, any>): CandidateV1 {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    kind: 'text',
    source: 'command-processor',
    createdAt: now,
    status: 'proposed',
    priority: 100,
    text,
    format: 'plain',
    metadata,
  };
}

/** Append a text candidate to the event, creating the candidates array if needed. */
export function appendTextCandidate(evt: InternalEventV2, text: string, metadata?: Record<string, any>): CandidateV1 {
  const candidate = createTextCandidate(text, metadata);
  if (!Array.isArray(evt.candidates)) evt.candidates = [];
  evt.candidates.push(candidate);
  return candidate;
}

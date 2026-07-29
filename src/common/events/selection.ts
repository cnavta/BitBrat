import { CandidateV1, InternalEventV2 } from '../../types/events';

function toDate(value?: string): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

function unwrapQuoted(input: string | undefined | null): string | undefined {
  if (input == null) return input as any;
  let t = String(input).trim();
  if (!t) return t;
  const pairs: Array<[string, string]> = [["\"", "\""], ["'", "'"], ["“", "”"], ["‘", "’"], ["`", "`"]];
  let changed = true;
  let guard = 0;
  while (changed && guard < 2) {
    changed = false;
    for (const [o, c] of pairs) {
      if (t.length >= 2 && t.startsWith(o) && t.endsWith(c)) {
        t = t.slice(o.length, t.length - c.length).trim();
        changed = true;
        break;
      }
    }
    guard++;
  }
  return t;
}

/**
 * Select the best candidate from a list based on priority (lowest wins),
 * confidence (highest wins), and random selection for ties.
 *
 * When multiple candidates have the same priority and confidence, one is
 * selected randomly rather than deterministically by creation time.
 */
export function selectBestCandidate(candidates: CandidateV1[] | undefined | null): CandidateV1 | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  // Find all candidates with the best (lowest) priority
  const minPriority = Math.min(...candidates.map(c =>
    typeof c.priority === 'number' ? c.priority : Number.POSITIVE_INFINITY
  ));
  const topPriority = candidates.filter(c =>
    (typeof c.priority === 'number' ? c.priority : Number.POSITIVE_INFINITY) === minPriority
  );

  // If only one candidate at top priority, return it
  if (topPriority.length === 1) return topPriority[0];

  // Find all candidates with the best (highest) confidence among top priority
  const maxConfidence = Math.max(...topPriority.map(c =>
    typeof c.confidence === 'number' ? c.confidence : -1
  ));
  const topConfidence = topPriority.filter(c =>
    (typeof c.confidence === 'number' ? c.confidence : -1) === maxConfidence
  );

  // If only one candidate, return it
  if (topConfidence.length === 1) return topConfidence[0];

  // Multiple candidates tied on priority and confidence - select randomly
  const randomIndex = Math.floor(Math.random() * topConfidence.length);
  return topConfidence[randomIndex];
}

/**
 * Extract the best candidate's text from an event, with fallback to legacy shapes.
 */
export function extractEgressTextFromEvent(evt: InternalEventV2 | any): string | null {
  try {
    // Prefer V2 candidates when present
    const candidates = (evt && evt.candidates) as CandidateV1[] | undefined;
    const best = selectBestCandidate(candidates);
    const text = unwrapQuoted(best?.text);
    if (typeof text === 'string' && text.trim()) return text.trim();

    // Fallback to potential legacy shapes inside raw platform payload
    // Fallback to potential legacy shapes inside raw platform payload ONLY if no candidates were expected
    // or if we explicitly want to support echoing. 
    // In V2, if we have candidates array (even empty), we should probably NOT fall back to the input message.
    if (Array.isArray(evt.candidates)) {
       return null;
    }

    // If it's a V2 egress event (has egress block and standard V2 message or candidates),
    // we should NOT fall back to legacy message if we don't have a valid candidate.
    // We check for evt.message as it is the anchor of the V2 structure.
    if (evt && evt.egress && (evt.message || Array.isArray(evt.candidates))) {
      return null;
    }

    const legacy1 = unwrapQuoted(evt?.message?.rawPlatformPayload?.chat?.text ?? evt?.message?.rawPlatformPayload?.text);
    if (typeof legacy1 === 'string' && legacy1.trim()) return legacy1.trim();
    // Fallback to pre-V2 legacy event shapes that carried payload at root
    const legacy2 = unwrapQuoted(evt?.payload?.chat?.text ?? evt?.payload?.text);
    if (typeof legacy2 === 'string' && legacy2.trim()) return legacy2.trim();
    return null;
  } catch {
    return null;
  }
}

/**
 * Mark the selected candidate on an InternalEventV2, if any candidates exist.
 * - Uses selectBestCandidate() with priority/confidence/createdAt tie-breakers.
 * - Returns a shallow-cloned event with candidates array updated; original object is not mutated.
 */
export function markSelectedCandidate(evt: InternalEventV2): InternalEventV2 {
  if (!evt || !Array.isArray(evt.candidates) || evt.candidates.length === 0) return evt;
  const best = selectBestCandidate(evt.candidates);
  if (!best) return evt;
  const selectedId = best.id;
  const updated: InternalEventV2 = {
    ...evt,
    candidates: evt.candidates.map((c) => (c.id === selectedId ? { ...c, status: 'selected' } : c)),
  };
  return updated;
}

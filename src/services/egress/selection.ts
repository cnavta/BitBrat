import { CandidateV1, InternalEventV2 } from '../../types/events';

function toDate(value?: string): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

export function selectBestCandidate(candidates: CandidateV1[] | undefined | null): CandidateV1 | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    // Primary: lowest priority wins (undefined treated as Infinity)
    const pa = typeof a.priority === 'number' ? a.priority : Number.POSITIVE_INFINITY;
    const pb = typeof b.priority === 'number' ? b.priority : Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb;
    // Secondary: higher confidence wins (undefined treated as -1)
    const ca = typeof a.confidence === 'number' ? a.confidence : -1;
    const cb = typeof b.confidence === 'number' ? b.confidence : -1;
    if (ca !== cb) return cb - ca;
    // Tertiary: earliest createdAt wins
    const ta = toDate(a.createdAt);
    const tb = toDate(b.createdAt);
    return ta - tb;
  });
  return sorted[0] ?? null;
}

export function extractEgressTextFromEvent(evt: InternalEventV2 | any): string | null {
  try {
    // Prefer V2 candidates when present
    const candidates = (evt && evt.candidates) as CandidateV1[] | undefined;
    const best = selectBestCandidate(candidates);
    const text = best?.text;
    if (typeof text === 'string' && text.trim()) return text.trim();

    // Fallback to potential legacy shapes inside raw platform payload
    const legacy1 = evt?.message?.rawPlatformPayload?.chat?.text ?? evt?.message?.rawPlatformPayload?.text;
    if (typeof legacy1 === 'string' && legacy1.trim()) return legacy1.trim();
    // Fallback to pre-V2 legacy event shapes that carried payload at root
    const legacy2 = evt?.payload?.chat?.text ?? evt?.payload?.text;
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

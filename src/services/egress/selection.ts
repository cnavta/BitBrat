import { CandidateV1, InternalEventV1, InternalEventV2 } from '../../types/events';

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

export function extractEgressTextFromEvent(evt: InternalEventV2 | InternalEventV1 | any): string | null {
  try {
    // Prefer V2 candidates when present
    const candidates = (evt && evt.candidates) as CandidateV1[] | undefined;
    const best = selectBestCandidate(candidates);
    const text = best?.text;
    if (typeof text === 'string' && text.trim()) return text.trim();

    // Fallback to V1 payload shapes
    const legacy = evt?.payload?.chat?.text ?? evt?.payload?.text;
    if (typeof legacy === 'string' && legacy.trim()) return legacy.trim();
    return null;
  } catch {
    return null;
  }
}

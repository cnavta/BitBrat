// ContextPack -> prompt-assembly NamedContext mapping (sprint-328, ADR §5.3 — P2)
//
// Packs render through the existing prompt-assembly layer so every service's context looks the same
// to the model (G4) and the assembler's priority-ordered sort/truncate (P-04) applies unchanged.
// A markdown body passes through as a string; a json body is passed as an object (the assembler
// renders objects as JSON deterministically). Default priority is 3 (matches NamedContext default).

import type { NamedContext, Priority } from '../prompt-assembly/types';
import type { ContextPack } from './types';

const DEFAULT_PRIORITY: Priority = 3;

/**
 * A lightweight, log-friendly reference to a ContextPack that was rendered into a prompt. Used by
 * services (e.g. llm-bot prompt logging) to record WHICH packs contributed to a generated prompt,
 * for debugging and analysis (sprint-328).
 */
export interface ContextPackRef {
  id: string;
  version: string;
  title: string;
  source: string;
}

/** Render the canonical `subheader` used to tag a pack-originated NamedContext (single source of truth). */
export function formatPackSubheader(pack: Pick<ContextPack, 'id' | 'version' | 'source'>): string {
  return `${pack.id} v${pack.version} (source: ${pack.source})`;
}

/**
 * Parse a NamedContext `subheader` back into its pack identity, or null when the subheader was not
 * produced by `formatPackSubheader` (i.e. the context did not originate from a ContextPack). Kept in
 * lock-step with `formatPackSubheader` so detection never drifts from rendering.
 */
export function parsePackSubheader(subheader?: string): { id: string; version: string; source: string } | null {
  if (!subheader) return null;
  const m = /^(\S+) v(\S+) \(source: (.+)\)$/.exec(subheader);
  if (!m) return null;
  return { id: m[1], version: m[2], source: m[3] };
}

/** Map a single ContextPack to a prompt-assembly NamedContext. */
export function packToNamedContext(pack: ContextPack): NamedContext {
  const content: string | object =
    pack.format === 'json' ? (pack.body as object) : String(pack.body ?? '');
  return {
    name: pack.title,
    content,
    priority: pack.priority ?? DEFAULT_PRIORITY,
    subheader: formatPackSubheader(pack),
  };
}

/** Map an ordered list of packs to NamedContexts (order preserved for stable assembly). */
export function packsToNamedContexts(packs: ContextPack[]): NamedContext[] {
  return packs.map(packToNamedContext);
}

/**
 * Inspect an assembled list of NamedContexts and return references to those that originated from a
 * ContextPack (identified by the `formatPackSubheader` convention). Order is preserved so callers can
 * log packs in the same order they appear in the prompt. Non-pack contexts are ignored.
 */
export function extractContextPacksFromNamedContexts(
  contexts?: ReadonlyArray<NamedContext>,
): ContextPackRef[] {
  if (!Array.isArray(contexts)) return [];
  const refs: ContextPackRef[] = [];
  for (const ctx of contexts) {
    const parsed = parsePackSubheader(ctx?.subheader);
    if (parsed) {
      refs.push({ id: parsed.id, version: parsed.version, title: ctx.name, source: parsed.source });
    }
  }
  return refs;
}

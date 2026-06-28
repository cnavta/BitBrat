// ContextPack -> prompt-assembly NamedContext mapping (sprint-328, ADR §5.3 — P2)
//
// Packs render through the existing prompt-assembly layer so every service's context looks the same
// to the model (G4) and the assembler's priority-ordered sort/truncate (P-04) applies unchanged.
// A markdown body passes through as a string; a json body is passed as an object (the assembler
// renders objects as JSON deterministically). Default priority is 3 (matches NamedContext default).

import type { NamedContext, Priority } from '../prompt-assembly/types';
import type { ContextPack } from './types';

const DEFAULT_PRIORITY: Priority = 3;

/** Map a single ContextPack to a prompt-assembly NamedContext. */
export function packToNamedContext(pack: ContextPack): NamedContext {
  const content: string | object =
    pack.format === 'json' ? (pack.body as object) : String(pack.body ?? '');
  return {
    name: pack.title,
    content,
    priority: pack.priority ?? DEFAULT_PRIORITY,
    subheader: `${pack.id} v${pack.version} (source: ${pack.source})`,
  };
}

/** Map an ordered list of packs to NamedContexts (order preserved for stable assembly). */
export function packsToNamedContexts(packs: ContextPack[]): NamedContext[] {
  return packs.map(packToNamedContext);
}

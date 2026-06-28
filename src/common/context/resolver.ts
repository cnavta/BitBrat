// Context Pack resolution + de-duplication (sprint-328, ADR §5.3 — P1/P2)
//
// Given an active set (tools/tasks/eventTypes for a turn) and a set of providers, resolve the
// bound ContextPacks, de-duplicated by pack id. A binding matches if ANY id in any of its `when`
// clauses appears in the corresponding active-set array. Unknown pack ids (a binding referencing a
// pack no provider exposes) are surfaced as a warning, not a throw. An empty active set is a no-op.

import type { ContextActiveSet, ContextBinding, ContextPack, ContextProvider } from './types';

export interface ResolveOptions {
  /** Optional warning sink for unknown pack ids; defaults to console.warn. */
  onWarn?: (message: string, meta?: Record<string, unknown>) => void;
}

function intersects(a?: string[], b?: string[]): boolean {
  if (!a || !b || a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  return b.some((x) => set.has(x));
}

/** Does this binding match the active set (tool OR task OR eventType hit)? */
export function bindingMatches(binding: ContextBinding, active: ContextActiveSet): boolean {
  const w = binding.when || {};
  return (
    intersects(active.tools, w.tools) ||
    intersects(active.tasks, w.tasks) ||
    intersects(active.eventTypes, w.eventTypes)
  );
}

function isEmptyActiveSet(active: ContextActiveSet): boolean {
  return (
    (!active.tools || active.tools.length === 0) &&
    (!active.tasks || active.tasks.length === 0) &&
    (!active.eventTypes || active.eventTypes.length === 0)
  );
}

/**
 * Resolve the ContextPacks bound to the given active set across all providers, de-duplicated by id.
 * Order is stable: packs are emitted in first-seen order of their matching bindings.
 */
export function resolveContextPacks(
  active: ContextActiveSet,
  providers: ContextProvider[],
  options: ResolveOptions = {},
): ContextPack[] {
  if (isEmptyActiveSet(active) || providers.length === 0) return [];
  const warn = options.onWarn || ((msg, meta) => console.warn(msg, meta ?? {}));

  // Build a pack index (last writer wins on duplicate ids across providers).
  const packsById = new Map<string, ContextPack>();
  for (const p of providers) {
    for (const pack of p.listPacks()) packsById.set(pack.id, pack);
  }

  const matchedIds: string[] = [];
  const seen = new Set<string>();
  for (const provider of providers) {
    for (const binding of provider.listBindings()) {
      if (!bindingMatches(binding, active)) continue;
      if (seen.has(binding.pack)) continue;
      if (!packsById.has(binding.pack)) {
        warn('context.resolve.unknown_pack', { pack: binding.pack });
        continue;
      }
      seen.add(binding.pack);
      matchedIds.push(binding.pack);
    }
  }

  return matchedIds.map((id) => packsById.get(id)!).filter(Boolean);
}

// Simple in-memory ContextProvider (sprint-328, P1)
//
// A service composes its packs + bindings into a StaticContextProvider. The Bit also uses one
// internally to expose the packs/bindings recorded via registerToolWithContext / registerContextPack.

import type { ContextBinding, ContextPack, ContextProvider } from './types';

/** A ContextProvider backed by in-memory arrays. */
export class StaticContextProvider implements ContextProvider {
  constructor(
    private readonly packs: ContextPack[] = [],
    private readonly bindings: ContextBinding[] = [],
  ) {}

  listPacks(): ContextPack[] {
    return [...this.packs];
  }

  listBindings(): ContextBinding[] {
    return [...this.bindings];
  }
}

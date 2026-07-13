// Just-in-Time Context Provisioning — Core Types (sprint-328, ADR §5.1)
//
// A ContextPack is a named, versioned, priority-tagged block of context (Markdown or JSON) that a
// service contributes. A ContextProvider is the interface a service implements to emit packs. A
// ContextBinding declares WHEN a pack is relevant — by tool name, task/stage, or event type — so
// packs are injected only when the related tool/task/event is in play (G1).

import type { Priority } from '../prompt-assembly/types';

/** A named, versioned, priority-tagged block of context contributed by a service. */
export interface ContextPack {
  /** Stable id, e.g. "schema.internal-event-v2", "router.jsonlogic-guide". */
  id: string;
  /** Pack version (aligns with the documented contract's version, e.g. InternalEventV2 'v'). */
  version: string;
  /** Human/agent-readable heading. */
  title: string;
  /** Maps to prompt-assembly Priority (1 = highest). Default applied at render time is 3. */
  priority?: Priority;
  /** Render format of `body`. */
  format: 'markdown' | 'json';
  /** Pack content. Rendered into a NamedContext. */
  body: string | object;
  /** Provenance, e.g. "src/types/events.ts" (G6). */
  source: string;
}

/** The active set of tools/tasks/event-types for a turn — packs are resolved against this. */
export interface ContextActiveSet {
  tools?: string[];
  tasks?: string[];
  eventTypes?: string[];
}

/** Declares when a ContextPack is relevant. A binding matches if ANY of its `when` clauses hit. */
export interface ContextBinding {
  /** ContextPack id this binding refers to. */
  pack: string;
  when: {
    /** MCP tool names, e.g. ["create_schedule"]. */
    tools?: string[];
    /** Task/stage identifiers, e.g. ["routing.create_rule", "enrichment"]. */
    tasks?: string[];
    /** InternalEventType values, e.g. ["llm.request.v1"]. */
    eventTypes?: string[];
  };
}

/** Interface a service (Bit) implements to emit packs and their bindings. */
export interface ContextProvider {
  listPacks(): ContextPack[] | Promise<ContextPack[]>;  // P4: async for VectorContextProvider
  listBindings(): ContextBinding[];
}

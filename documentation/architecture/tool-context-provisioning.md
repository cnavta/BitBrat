# Just-in-Time Context Provisioning for Tools & Tasks

**Status:** Proposal / Architecture Decision Record (ADR)
**Author:** AI Architect
**Audience:** Lead Architect, Lead Implementor, Quality Lead
**Related:** `architecture.yaml`, `documentation/mcp-evolution-roadmap.md`, `src/types/events.ts` (`InternalEventV2`), `src/common/prompt-assembly/*`, `src/common/mcp/*`

---

## 1. Problem Statement

BitBrat services expose capabilities to LLM agents primarily as **MCP tools**. A tool's contract is just a `name`, a one-line `description`, and a Zod/JSON input schema. That contract is *structurally* complete but *semantically* starved: it tells the model **what fields exist**, not **what the platform means by them**.

Concrete, observed gaps in the current codebase:

### 1.1 Scheduler — "schedule a prompt in 5 minutes"
`src/apps/scheduler-service.ts` registers `create_schedule`. Its `EventDefinitionSchema` is:

```ts
const EventDefinitionSchema = z.object({
  type: z.string().describe("InternalEventType for the produced event"),
  payload: z.record(z.any()).optional().describe("Payload for the InternalEventV2"),
  message: z.object({ /* ... */ }).optional(),
  annotations: z.array(z.record(z.any())).optional().describe("Optional annotations"),
});
```

The tool faithfully says "produce an `InternalEventV2`" — but the agent has **no idea** that:
- a "prompt" is not an event `type`; it is an **annotation** of `kind: 'prompt'` (`AnnotationKindV1` in `src/types/events.ts`);
- the event that drives the bot is typically `type: 'llm.request.v1'` (or a chat event) carrying that annotation;
- `annotations` is an array of `AnnotationV1` objects (`{ id, kind, source, createdAt, value?, payload? }`), not a free-form bag.

So "schedule a prompt 5 minutes from now" is unanswerable without the agent guessing the `InternalEventV2` shape.

### 1.2 Event Router — authoring routing rules
`src/apps/event-router-service.ts` registers `create_rule`:

```ts
logic: z.string().describe('A JsonLogic expression as a JSON string.'),
```

The agent is asked to write JsonLogic but is told nothing about:
- the **evaluation context** it can reference (`buildContext` in `src/services/router/jsonlogic-evaluator.ts` exposes `type`, `identity`, `annotations`, `candidates`, `routingSlip`, plus flattened legacy paths `source`/`channel`/`userId`);
- the **custom operators** registered for rules: `ci_eq`, `re_test`, `slip_complete`, `has_role`, `has_annotation`, `has_candidate`, `text_contains`;
- the meaning of `services` (they become a routing slip via `RuleMapper`/`SERVICE_TOPIC_MAP`), or what `customAnnotation`/`promptTemplate` actually attach to an event.

### 1.3 Enrichment
The same shape problem appears when an agent reasons about enrichment (`src/services/auth/enrichment.ts`): it mutates `identity.user`, `identity.auth`, and may append annotations/candidates. An agent proposing or validating enrichment behavior needs the `Identity`/`AnnotationV1` contracts in front of it.

### 1.4 The shared root cause
Each service independently "knows" a slice of the `InternalEventV2` contract, but that knowledge lives in **TypeScript types and human docs**, not in anything the agent can see at decision time. The same `InternalEventV2` schema is the hidden dependency behind **all three** surfaces (scheduling, rule logic, enrichment).

We need **one consistent mechanism** by which a service can attach *additional, relevant* context to an agent interaction **only when a specific tool/task is invoked** — not by bloating every system prompt with the entire platform schema.

---

## 2. Design Goals & Constraints

| # | Goal |
|---|------|
| G1 | **Relevance-gated**: context is surfaced only when the related tool/task is in play. |
| G2 | **Single source of truth**: derived from `InternalEventV2` / `architecture.yaml`, not hand-copied. (Immutable Law #2.) |
| G3 | **Token-aware**: must not blow the context window; co-exists with the RAG tool-discovery plan in `mcp-evolution-roadmap.md`. |
| G4 | **Service-owned, platform-consistent**: each service authors its own context; the platform renders it uniformly. |
| G5 | **Composable**: works for MCP tools *and* for internal task pipelines (routing, enrichment) that are not user-facing tools. |
| G6 | **Versioned & traceable**: context blocks carry a schema version and source, per the V2 "explicit, versioned contracts" principle. |

---

## 3. Prior Art — How the Industry Handles "Context Only When Needed"

This is a recognized problem in agentic orchestration. The dominant patterns, roughly in order of increasing sophistication:

### 3.1 Rich tool/parameter descriptions (the baseline)
The simplest lever: encode semantics directly into the tool description and per-parameter descriptions (JSON Schema `description`, `enum`, `examples`). Function-calling models (OpenAI tools, Anthropic tool use, Vercel AI SDK) are explicitly trained to read these.
- **Pros:** zero new infrastructure; context is inherently scoped to the tool.
- **Cons:** doesn't scale to shared cross-cutting schemas (the same `InternalEventV2` blurb would be duplicated into dozens of tools); descriptions have practical length limits.

### 3.2 MCP Resources & Prompts (protocol-native context)
The Model Context Protocol deliberately separates three primitives:
- **Tools** — model-invoked actions.
- **Resources** — application/data context the host can attach (e.g., a schema document, a file, a record).
- **Prompts** — user/host-selected templates that pre-load instructions and context.

The intended pattern is: a tool *does* the thing; an associated **Resource** carries the schema/explainer; a **Prompt** stitches them together for a given task. BitBrat already has `registerResource`/`registerPrompt` in `src/common/mcp-server.ts` but they are currently underused for schema context.

### 3.3 Retrieval-Augmented Generation for context (RAG / "context engineering")
Instead of statically injecting everything, embed candidate context fragments (schemas, examples, docs) and retrieve the top-N relevant ones for the current turn. This is exactly the trajectory in BitBrat's own `mcp-evolution-roadmap.md` Phase 2 (semantic *tool* discovery via database vector search). The same machinery generalizes from "which tools" to "which context blocks."
- **Pros:** scales to large schema/doc corpora; naturally relevance-gated.
- **Cons:** retrieval errors → missing/irrelevant context; added latency and infra.

### 3.4 Just-in-Time / progressive disclosure & context hooks
Frameworks (LangGraph, AutoGen, Semantic Kernel, OpenAI Assistants, Anthropic's "tool result + context" guidance) increasingly expose **hooks** that fire when a tool is selected or a task node is entered, letting the application inject scoped context *at that moment* rather than up front. A tool can also **return** clarifying schema/examples in its result (e.g., a "describe" or "schema" companion tool, or a structured error that teaches the model the correct shape).
- **Pros:** maximally lazy; minimal idle token cost.
- **Cons:** requires an orchestrator with lifecycle hooks.

### 3.5 Schema-as-context / self-describing capabilities
Mature platforms expose a machine-readable capability/schema endpoint (think GraphQL introspection, OpenAPI, JSON Schema `$defs`) and feed *only the relevant slice* into the prompt. The contract is generated from the source of truth, so it never drifts.
- **Pros:** zero drift; precise scoping by `$ref`.
- **Cons:** raw JSON Schema is verbose; usually needs a summarizer/curator layer.

### 3.6 Synthesis
The robust production answer is a **layering**: rich descriptions (3.1) for the obvious stuff, **protocol-native resources/prompts** (3.2) and **generated schema slices** (3.5) for shared contracts, **relevance-gating** (3.3/3.4) so only the needed slice is paid for, all assembled by a **single prompt-assembly layer** so rendering is consistent.

BitBrat is unusually well-positioned: it already has (a) MCP resource/prompt primitives, (b) a structured **prompt-assembly** module with priority-ordered `NamedContext` blocks, and (c) a planned RAG/registry layer. The recommendation below wires these together rather than inventing new infrastructure.

---

## 4. Current BitBrat Building Blocks (what we already have)

| Capability | Where | Note |
|---|---|---|
| MCP tool registration (name/desc/Zod) | `src/common/mcp-server.ts` `registerTool` | semantics only via `description` today |
| MCP **resource** & **prompt** registration | `src/common/mcp-server.ts` `registerResource` / `registerPrompt` | present, under-used for schema context |
| Tool aggregation / bridge / discovery | `src/common/mcp/` (`bridge.ts`, `client-manager.ts`, `registry-watcher.ts`), `src/apps/tool-gateway.ts` | the natural place to gate context |
| **Prompt assembly** with `NamedContext`, `TaskAnnotation`, `Constraint`, priorities | `src/common/prompt-assembly/*` | render target for injected context |
| Canonical schema | `src/types/events.ts` (`InternalEventV2`, `AnnotationV1`, …) | the source of truth to project from |
| JsonLogic context + custom ops | `src/services/router/jsonlogic-evaluator.ts` | the context an agent needs to author rules |
| RAG tool-discovery plan | `documentation/mcp-evolution-roadmap.md` | reuse the same retrieval substrate |

The gap is **not** missing infrastructure; it is the absence of a **convention** that connects a tool/task to the schema context it implies, and a place to render that context just-in-time.

---

## 5. Recommended Path Forward for BitBrat

### 5.1 Core idea: the **Context Pack**, attached by **Context Providers**, gated by **bindings**

Introduce one small, consistent abstraction:

> A **Context Pack** is a named, versioned, priority-tagged block of context (Markdown or JSON) that a service contributes. A **Context Provider** is the interface a service implements to emit packs. A **binding** declares *when* a pack is relevant — by tool name, task/stage, or event type — so packs are injected **only when needed**.

```ts
// proposed: src/common/context/types.ts
export interface ContextPack {
  id: string;                 // "schema.internal-event-v2", "router.jsonlogic-guide"
  version: string;            // e.g. "2"  (aligns with InternalEventV2 'v')
  title: string;              // human/agent-readable heading
  priority?: 1|2|3|4|5;       // maps to prompt-assembly Priority
  format: 'markdown' | 'json';
  body: string | object;      // rendered into a NamedContext
  source: string;             // provenance, e.g. "src/types/events.ts"
}

export interface ContextBinding {
  pack: string;               // ContextPack id
  when: {
    tools?: string[];         // e.g. ["create_schedule"]
    tasks?: string[];         // e.g. ["routing.create_rule", "enrichment"]
    eventTypes?: string[];    // e.g. ["llm.request.v1"]
  };
}

export interface ContextProvider {
  listPacks(): ContextPack[];
  listBindings(): ContextBinding[];
}
```

### 5.2 Two surfaces, one mechanism

**(a) MCP tools (scheduler, event-router admin tools, etc.)**
Expose each Context Pack as an **MCP Resource** (we already have `registerResource`) with a stable URI, e.g. `context://schema/internal-event-v2`. Add a tiny helper `registerToolWithContext(tool, packIds[])` that records the binding alongside the existing `registerTool`. The MCP registration event (`INTERNAL_MCP_REGISTRATION_V1`) is extended to advertise the server's packs + bindings so the **tool-gateway** can resolve them centrally.

**(b) Internal task pipelines (routing, enrichment) that are not user tools**
These don't go through MCP tool-calling, so bind packs to **task/stage/eventType**. When the orchestrator enters the relevant node (e.g. the bot is about to author a rule, or the router stage is `analysis`), it pulls the bound packs.

### 5.3 Injection point: the prompt-assembly layer (just-in-time)
At the moment the agent context is built (in `tool-gateway`/`McpBridge` for tool turns, or in the bot's prompt build for tasks):

1. Determine the **active set**: tools registered for this turn + current task/stage + event `type`.
2. Resolve bound Context Packs via the binding index.
3. **De-duplicate** (the `InternalEventV2` pack is shared by scheduler, router, enrichment — include it once).
4. Map each pack to a `NamedContext` (`src/common/prompt-assembly/types.ts`) with its `priority`, and let the existing assembler render/sort/truncate.

This satisfies **G1** (only active tools/tasks pull context) and **G3** (assembler already truncates by priority).

### 5.4 Keep packs honest: generate from the source of truth
The `schema.internal-event-v2` pack must be **generated**, not hand-written, to honor Immutable Law #2 and G2/G6:
- Derive a trimmed JSON Schema / curated Markdown from `src/types/events.ts` (e.g. via `zod-to-json-schema` for the relevant sub-shapes, or `ts-json-schema-generator`) at build time.
- For routing, generate the JsonLogic guide pack from the operator list and `EvalContext` keys in `jsonlogic-evaluator.ts` (single place those are defined), so new operators auto-document.
- Add a unit test asserting each pack's referenced field paths/operators still exist (drift guard).

### 5.5 Worked examples (what the agent would receive)

**Scheduler — `create_schedule` turn** pulls pack `schema.internal-event-v2` (kind summary + annotation contract):
> *Context [Event Schema v2]:* To schedule a "prompt", emit an `InternalEventV2` with `type: "llm.request.v1"` and an annotation `{ kind: "prompt", value: "<text>", source: "scheduler", … }`. `annotations` is an array of `AnnotationV1`. Valid annotation kinds include: `prompt`, `instruction`, `personality`, `intent`, … 

Now "schedule a prompt 5 minutes from now" resolves to a correct `schedule.value` (ISO `+5m`) + a well-formed `event.annotations[]`.

**Event Router — `create_rule` turn** pulls `router.jsonlogic-guide`:
> *Context [JsonLogic for Routing]:* Available paths: `type`, `identity.*`, `annotations[]`, `candidates[]`, `routingSlip`, `source`, `channel`, `userId`. Custom ops: `has_annotation(event,key[,value])`, `has_role(roles,role)`, `text_contains(value,needle[,ci])`, `re_test`, `ci_eq`, `slip_complete`. `services` become the routing slip; `customAnnotation` attaches an `AnnotationV1`.

### 5.6 Alignment with the MCP Evolution Roadmap
Phase 2 of `mcp-evolution-roadmap.md` already plans database-backed, embedding-driven **tool** discovery. Context Packs are stored and retrieved by the **same substrate**: persist packs in the database, embed their titles/bodies, and when the bound-tool set is large or open-ended, **retrieve** the top-N relevant packs instead of statically attaching them. Static bindings (5.2) are the deterministic floor; RAG is the scale-out path. This avoids a competing mechanism (G3/G4).

---

## 6. Phased Implementation

| Phase | Scope | Deliverable |
|---|---|---|
| **P0 – Quick win** | Enrich descriptions + add MCP **Resources** for `schema.internal-event-v2` and `router.jsonlogic-guide`; register them on scheduler & event-router. | Immediate relief, no orchestrator change. |
| **P1 – Convention** | Add `src/common/context/` (`ContextPack`/`ContextBinding`/`ContextProvider`) + `registerToolWithContext`; bind packs to tools. | Consistent, service-owned packs. |
| **P2 – JIT assembly** | Resolve + de-dupe bound packs in `tool-gateway`/`McpBridge`; render via `prompt-assembly` `NamedContext`. Extend `INTERNAL_MCP_REGISTRATION_V1` to advertise packs/bindings. | True just-in-time injection. |
| **P3 – Generated + drift-guarded** | Generate packs from `events.ts` / `jsonlogic-evaluator.ts`; add drift tests. | Zero schema drift (Law #2). |
| **P4 – RAG scale-out** | Persist + embed packs in the database; retrieve top-N when binding sets are large. Fold into roadmap Phase 2. | Scales to large ecosystems. |

---

## 6.1 Implementation note (sprint-328) — what shipped + the P4 seam

P0–P3 shipped in sprint-328 (`src/common/context/`): the `ContextPack`/`ContextBinding`/`ContextProvider`
convention, `Bit.registerToolWithContext` + `registerContextPack`/`registerContextBinding`, a
de-duplicating `resolveContextPacks(activeSet, providers)`, a `packToNamedContext` renderer, the two
**generated** packs (`schema.internal-event-v2` from `events.ts`, `router.jsonlogic-guide` from
`jsonlogic-evaluator.ts`) with drift-guard tests, MCP Resources (`context://…`), and additive
advertisement of `payload.context.{packs,bindings}` on `INTERNAL_MCP_REGISTRATION_V1` resolved
centrally by the tool-gateway (`ToolGatewayServer.resolveContextForTools`).

**P4 (RAG scale-out) is deferred / design-only.** The seam already exists: `resolveContextPacks`
takes an array of `ContextProvider`s, and the gateway aggregates one provider per registered Bit.
A future database/embedding-backed retrieval source only needs to implement `ContextProvider`
(`listPacks`/`listBindings`) — or a `resolveContextPacks` variant that ranks/top-N's packs — without
changing any caller. Static bindings remain the deterministic floor (§5.6); RAG reuses the
`mcp-evolution-roadmap.md` Phase 2 substrate rather than introducing a competing mechanism. No
database/embedding code ships until the owner pulls P4 into scope.

## 7. Trade-offs & Risks

- **Token budget:** mitigated by relevance-gating (G1), de-dup, and priority-based truncation in the assembler. Keep packs short; prefer curated Markdown over raw JSON Schema dumps.
- **Drift:** the central risk. Hand-written packs *will* rot — hence P3 generation + drift tests are non-optional for the schema pack.
- **Over-injection:** binding too broadly re-creates the "everything in the prompt" problem. Bind narrowly (specific tool/task/eventType), measure, widen only with evidence.
- **Latency (P4):** retrieval adds a hop; gate RAG behind a size threshold and cache embeddings.
- **Consistency:** all rendering goes through `prompt-assembly` so every service's context looks the same to the model (G4).

---

## 8. Recommendation Summary

1. Adopt a single **Context Pack / Context Provider / binding** convention (`src/common/context/`).
2. Surface packs to tool-using agents via **MCP Resources** + bindings; surface to internal pipelines via task/stage/eventType bindings.
3. Inject **just-in-time** through the existing **prompt-assembly** layer (`NamedContext`, priority-ordered), de-duplicating shared schema packs.
4. **Generate** the `InternalEventV2` and JsonLogic packs from source of truth and guard with drift tests.
5. **Scale** with the already-planned database + vector retrieval substrate (`mcp-evolution-roadmap.md`), reusing it for context, not just tools.

This gives every service a consistent, low-drift way to say "here is what you need to know to use me correctly" — and the agent only pays for it when that service's tool or task is actually in play.

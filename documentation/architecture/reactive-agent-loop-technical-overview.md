# Technical Architecture Overview: Reactive Agent Loop

> Status: Proposed architecture overview
> Date: 2026-07-10
> Scope: Formalizing BitBrat's event lifecycle as Event -> Attention -> Contextualization -> Analysis -> Reaction -> Introspection -> Learning, aligned to `architecture.yaml`.
> Precedence: `architecture.yaml` remains canonical. This document proposes an additive formalization of the current `ingest -> route -> analysis/enrichment -> reaction -> egress -> persist` lifecycle.

## Executive Summary

BitBrat is already close to a reactive agent platform. The current architecture describes a decentralized message bus, `InternalEventV2`, routing slips, platform Bits, reflex execution, LLM analysis, state mutation, disposition, persistence, and a universal `bit.*` MCP control plane. The current naming, however, still frames the hot path mostly as `ingest -> route -> analysis/enrichment -> reaction -> egress`.

The platform should formalize the agent lifecycle as:

```text
Event -> Attention -> Contextualization -> Analysis -> Reaction -> Introspection -> Learning
```

Each stage is a policy-bounded transformation over the same correlated event record. The routing slip remains the execution mechanism, but each step declares its lifecycle stage, allowed actions, policy envelope, and emitted evidence. This gives BitBrat a clearer mental model for agent behavior without replacing the existing bus, Bit model, or routing engine.

The key architectural shift is to treat policy enforcement as a reactive perimeter around every stage, not as a single gate in front of tools. Every event carries enough identity, context, risk, scope, and authorization state for a stage-local policy decision. A stage may enrich, suppress, route, act, observe, or propose learning, but only within the action set allowed for that event at that stage.

## Current State

### What Exists Today

`architecture.yaml` defines BitBrat as an LLM-powered event orchestration and execution engine using Cloud Run services, Pub/Sub or NATS, and `InternalEventV2` messages. The canonical dataflow is:

```text
ingest -> route -> analysis/enrichment -> reaction -> egress -> persist
```

Important existing primitives:

- `InternalEventV2` carries `correlationId`, `traceId`, `ingress`, `identity`, `egress`, `externalEvent`, `message`, `annotations`, `candidates`, `qos`, `routing`, `errors`, and `metadata`.
- Routing slips drive decentralized orchestration through `RoutingStep` records with `id`, `status`, `attempt`, `maxAttempts`, `nextTopic`, `attributes`, timestamps, and error metadata.
- `event-router` evaluates JsonLogic rules, attaches routing slips, adds rule-driven enrichments, and advances the event.
- `auth` enriches events with user identity and authentication metadata.
- `query-analyzer`, `llm-bot`, `disposition-service`, and `story-engine-mcp` already perform forms of analysis and contextual enrichment.
- `reflex` provides a deterministic low-latency reaction path through MCP tools, bypassing full LLM reasoning when a pattern matches.
- `tool-gateway` and `Bit` MCP surfaces already provide RBAC-aware tool discovery and invocation.
- `Bit` exposes universal `bit.*` control-plane tools with `bit:read` and `bit:operate` scopes.
- `persistence` captures snapshots and dead letters for durable audit and recovery.

### Gaps In The Current Model

The proposed lifecycle is visible in pieces, but not yet first-class:

- Attention is implicit in router rule matching and reflex pattern matching, but there is no normalized attention score or importance contract.
- Contextualization is spread across `auth`, user context, disposition, query analysis, prompt assembly, and rule enrichments.
- Authentication and authorization are not explicitly modeled as the first contextualization sub-stage, even though they function that way.
- Policy exists in multiple places: MCP RBAC, LLM behavioral tool filtering, feature flags, routing rules, and service-level guardrails. There is no stage-level policy envelope in the event.
- Introspection is mostly observability, persistence snapshots, reflex result events, and errors. It is not yet a formal stage that evaluates whether the reaction was appropriate.
- Learning is represented by state mutation, disposition updates, memory/context additions, and backlog-worthy observations, but there is no controlled learning proposal/review path.

## Proposed Lifecycle Model

### 1. Event

An Event is any normalized occurrence that can enter the platform: Twitch/Discord/Twilio activity, API input, scheduler ticks, MCP control-plane calls, internal results, state changes, dead letters, introspection outputs, or learning proposals.

Current mapping:

- External events enter through `ingress-egress` or `api-gateway`.
- Scheduled events enter through `scheduler`.
- Internal events already appear as topics such as `internal.reflex.executed.v1`, `internal.reflex.failed.v1`, `internal.user.disposition.updated.v1`, and `internal.state.mutation.v1`.

Formalization:

- Preserve `InternalEventV2` as the event record.
- Require all lifecycle events to carry `correlationId`.
- Add stage evidence through `annotations`, `candidates`, `metadata`, and routing history rather than inventing a second envelope.
- Treat reaction results as new events eligible for attention.

### 2. Attention

Attention answers: should this event be handled, ignored, delayed, summarized, escalated, or routed to a deterministic reflex?

Current mapping:

- `event-router` rule matching determines whether an event gets a routing slip or falls to DLQ/default behavior.
- Reflex pattern matching handles deterministic, high-priority actions.
- QoS hints (`qos.maxResponseMs`, `qos.tracer`) already affect processing behavior.

Formalization:

- Add an attention annotation contract, for example:

```json
{
  "kind": "attention",
  "source": "event-router",
  "label": "handle",
  "score": 0.86,
  "payload": {
    "priority": "normal",
    "reason": "bot mention and known user",
    "suppressionUntil": null
  }
}
```

- Attention outcomes should include `ignore`, `observe_only`, `defer`, `handle`, `escalate`, and `reflex`.
- Router rules remain the first implementation vehicle. A future `attention-service` could be introduced only if scoring becomes too complex for JsonLogic and rule enrichments.

### 3. Contextualization

Contextualization reestablishes enough event-local context to support initial analysis. Authentication and authorization are always first because all later context, tools, and actions depend on who/what the event represents.

Current mapping:

- `auth` enriches `identity.user` and `identity.auth`.
- User context, disposition context, and prompt assembly add event-local operating context.
- `query-analyzer` emits annotations and disposition observations.
- Firestore-backed state and persistence snapshots provide short and durable context.

Formalization:

- Contextualization should be an explicit routing stage with ordered sub-stages:
  1. Authenticate external identity.
  2. Authorize event scope and actor roles.
  3. Resolve platform/channel/session context.
  4. Resolve user state, disposition, memory, and recent interaction context.
  5. Redact or bound context according to policy before analysis.
- `identity.auth.matched` should be interpreted as a required input to stage policy.
- Context should be represented as annotations and bounded metadata, with large or reusable context available through context packs/resources rather than copied into every event.

### 4. Analysis

Analysis answers: what does this contextualized event mean for this Bit or agent instance?

Current mapping:

- `query-analyzer` performs fast analysis.
- `llm-bot` performs deeper LLM reasoning and behavioral profiling.
- `disposition-service` computes short-term user disposition.
- `story-engine-mcp` and other domain Bits can enrich event meaning.

Formalization:

- Analysis should produce typed annotations and candidates, not side effects.
- Analysis output should be inspectable and replayable from persisted event snapshots.
- Analysis may select a reaction path, but policy should still re-check at Reaction before side effects.
- Deterministic reflex selection can be modeled as a low-latency analysis result when it decides a known pattern is safe and sufficient.

Recommended annotation types:

- `intent`: what the event asks for or implies.
- `risk`: safety/privacy/abuse/deployment risk.
- `disposition`: short-term user behavioral context.
- `capability`: what platform capabilities may be relevant.
- `response-strategy`: whether to reply, refuse, deescalate, tool-call, or observe only.

### 5. Reaction

Reaction performs allowed actions based on the analysis.

Current mapping:

- `reflex` executes deterministic MCP tool calls and publishes result/failure events.
- `llm-bot` generates responses and may call tools through the gateway.
- `state-engine` applies state mutations.
- `ingress-egress` and `api-gateway` deliver egress responses.

Formalization:

- A reaction is any side effect: external message, MCP tool call, state mutation, scheduling change, operator action, or internal event publication.
- Reaction must consume the final policy envelope for the event, not just trust prior analysis.
- Every reaction should emit a result event or append a result annotation:
  - `reaction.started`
  - `reaction.succeeded`
  - `reaction.failed`
  - `reaction.suppressed`
- Tool calls should continue to flow through `tool-gateway` where possible because it provides a central RBAC and discovery chokepoint.
- Reflex and LLM reactions should converge on the same result evidence format so introspection does not care which path acted.

### 6. Introspection

Introspection evaluates whether the reaction and its results were appropriate.

Current mapping:

- Persistence snapshots capture initial/update/final/deadletter states.
- Reflex publishes success and failure events.
- LLM bot records runtime annotations and tool errors.
- Disposition observations capture behavior signals over time.
- Logs and traces contain operational evidence.

Formalization:

- Introduce an `internal.introspection.v1` topic for post-reaction review events.
- Introspection should be triggered by final snapshots, reaction result events, DLQ events, explicit user feedback, tool errors, and selected high-risk interactions.
- Introspection is analytical and should not mutate long-lived behavior directly. It should emit observations or learning proposals.
- Introspection outputs should include:
  - expected outcome vs. actual outcome
  - policy decisions made at each stage
  - suppressed actions and reasons
  - latency/cost/error metrics
  - user feedback or platform outcome, when available

### 7. Learning

Learning applies durable improvements based on introspection.

Current mapping:

- `state-engine` applies state mutations.
- `disposition-service` updates short-term behavioral state.
- Routing rules and feature flags can be changed by operators or tools.
- Context packs and prompt assembly can improve future decisions.

Formalization:

- Learning should be a controlled proposal-and-apply pipeline, not an automatic write path from every introspection.
- Add an `internal.learning.proposal.v1` topic and a policy-gated learning applier.
- Learning proposals may target:
  - routing rules
  - reflex definitions
  - context packs
  - durable memory/state
  - prompt constraints
  - test cases or backlog items
  - feature flag defaults
- High-impact learning should require review or elevated `bit:operate` authorization.
- Low-risk learning, such as updating short-term disposition or remembering user preferences with consent, can be auto-applied behind explicit policy.

## Reactive Policy Enforcement

Policy should surround every lifecycle stage:

```text
              +-----------------------------+
Event ------> | Policy: may attend?         | -> Attention
Attention --> | Policy: may contextualize?  | -> Contextualization
Context ----> | Policy: may analyze?        | -> Analysis
Analysis ---> | Policy: may react?          | -> Reaction
Reaction ---> | Policy: may introspect?     | -> Introspection
Intro ------> | Policy: may learn/apply?    | -> Learning
              +-----------------------------+
```

This is not one monolithic policy service. It is a standard contract that each stage enforces locally with shared libraries and central configuration.

### Policy Envelope

The event should carry a stage-local policy envelope in `metadata.policy` or a dedicated annotation. A minimal version could look like:

```json
{
  "stage": "reaction",
  "decision": "allow",
  "allowedActions": ["egress.chat", "tool.read"],
  "deniedActions": ["tool.write", "state.mutation"],
  "scope": "chat.response",
  "subject": {
    "userId": "twitch:123",
    "roles": ["subscriber"]
  },
  "reasons": ["authenticated user", "low risk", "rule allowed chat response"],
  "expiresAt": "2026-07-10T18:30:00Z"
}
```

Recommended rule:

- Earlier stages may narrow allowed actions.
- Later stages may not widen allowed actions without re-authorizing.
- Missing policy should fail closed for side effects and fail open only for safe observation/persistence.

### Policy Inputs

Stage policy should evaluate:

- authenticated identity and roles
- event source and connector
- requested scope
- risk annotations
- attention score and priority
- QoS and trace settings
- tool/resource scopes
- service capability profile
- current feature flags
- event history and prior policy decisions

### Policy Outputs

Every policy decision should produce evidence:

- `allow`, `deny`, `suppress`, `defer`, or `escalate`
- allowed action set
- denied action set
- reason codes
- source policy version
- expiration or revalidation condition

## Routing Slip Formalization

The existing routing slip should remain the execution backbone. Add stage semantics to step attributes first, then promote to schema fields after validation.

Example:

```json
{
  "id": "auth",
  "v": "2",
  "status": "PENDING",
  "nextTopic": "internal.auth.v1",
  "attributes": {
    "stage": "contextualization",
    "policyProfile": "auth-first",
    "allowedActions": "identity.enrich"
  }
}
```

Recommended lifecycle mapping:

| Proposed stage | Current services/topics |
| --- | --- |
| Event | `ingress-egress`, `api-gateway`, `scheduler`, internal result topics |
| Attention | `event-router`, router rules, reflex matcher |
| Contextualization | `auth`, user context, disposition lookup, context packs |
| Analysis | `query-analyzer`, `llm-bot`, `disposition-service`, domain MCP Bits |
| Reaction | `reflex`, `llm-bot`, `state-engine`, `tool-gateway`, egress |
| Introspection | persistence snapshots, result events, DLQ, proposed `internal.introspection.v1` |
| Learning | `state-engine`, routing/reflex updates, proposed `internal.learning.proposal.v1` |

## Event Evidence Model

To keep the system auditable and replayable:

- Events are facts.
- Annotations are interpretations.
- Candidates are possible actions or responses.
- Routing slips are execution plans and history.
- Policy decisions are constraints and justifications.
- Reaction result events are evidence.
- Learning proposals are requests to change future behavior.

This avoids collapsing analysis, action, and learning into one opaque LLM turn.

## Implementation Strategy

### Phase 1: Document And Type The Lifecycle

- Add lifecycle stage names to documentation and generated context packs.
- Extend `RoutingStage` to include `event`, `attention`, `contextualization`, `analysis`, `reaction`, `introspection`, and `learning`, while preserving backward compatibility with existing stage values.
- Define annotation conventions for `attention`, `policy`, `risk`, `response-strategy`, `reaction-result`, `introspection`, and `learning-proposal`.

### Phase 2: Make Attention Explicit

- Teach router rule enrichments to emit attention annotations.
- Add default attention outcomes for no-match, DLQ, reflex, LLM, and egress paths.
- Add tests proving attention annotations are preserved through routing.

### Phase 3: Auth-First Contextualization

- Standardize routes so events requiring user-aware behavior pass through `auth` before analysis/reaction.
- Add policy checks that suppress tools and state mutations when `identity.auth` is missing, stale, or unmatched.
- Preserve anonymous/guest handling as an explicit policy outcome, not an accidental null path.

### Phase 4: Stage Policy Library

- Create a shared policy evaluator for stage-local decisions.
- Integrate it with router decisions, `llm-bot` tool filtering, `reflex` execution, `state-engine`, and `tool-gateway`.
- Record policy decisions as annotations or metadata on every side-effect-capable stage.

### Phase 5: Reaction Result Events

- Normalize reflex, LLM, state, and egress reaction results into a common event shape.
- Ensure failed and suppressed reactions are as visible as successful reactions.
- Feed result events into persistence and introspection.

### Phase 6: Introspection And Learning

- Add `internal.introspection.v1` and `internal.learning.proposal.v1`.
- Implement an introspection worker that consumes final snapshots and reaction results.
- Implement a learning proposal store with review states: `proposed`, `approved`, `applied`, `rejected`, `expired`.
- Apply only policy-approved, scoped learning automatically.

## Architecture Considerations

### Idempotency

All new stages must preserve the at-least-once message bus contract. Policy decisions, reaction results, introspection outputs, and learning proposals need deterministic IDs derived from `correlationId`, stage, step id, and attempt.

### Privacy And Redaction

Contextualization and learning are the highest privacy-risk stages. Context should be minimized before analysis, and learning proposals must not persist raw private payloads unless explicitly allowed by policy.

### Latency

Attention and auth-first contextualization must stay fast. Reflex should remain a low-latency path. Introspection and learning should usually run off the hot path after egress or finalization.

### Operator Control

The Bit control plane is a strong fit for policy and learning administration:

- `bit.info` and `bit.health` support fleet introspection.
- `bit.flags.*` can roll stage policy features gradually.
- `bit.log.level` and tracing support event investigation.
- Future `bit.policy.*` or `bit.learning.*` tools could expose read-only inspection and elevated operator actions.

## Recommended Canonical Updates

If accepted, `architecture.yaml` should be updated in a future sprint to:

- Rename the `dataflow.description` from the older lifecycle wording to the reactive lifecycle wording.
- Add the lifecycle stage list as canonical stages.
- Add topic definitions for `internal.introspection.v1` and `internal.learning.proposal.v1`.
- Define a policy envelope convention under `messaging` or `dataflow`.
- Clarify that `auth` is the first contextualization stage for user-aware routes.

These changes should be additive and versioned. Existing topics and stage names should remain supported until routing rules and tests are migrated.

## Proposed Definition Of Done For A Future Implementation Sprint

- Lifecycle stages are represented in TypeScript types and documentation.
- Router emits attention annotations for matched, unmatched, reflex, and LLM paths.
- Auth-first contextualization is covered by routing tests.
- Reaction-capable services enforce shared stage policy before side effects.
- Reflex and LLM reactions produce normalized result evidence.
- Introspection consumes result/finalization evidence and produces learning proposals.
- Learning proposals are policy-gated, persisted, reviewable, and idempotent.
- Validation covers build, tests, schema compatibility, and migration safety.

Technical Architecture — InternalEventV2 and Message Flow (Architect)

Date: 2025-11-30
Sprint: sprint-107-8ae3c1
Branch: feature/sprint-107-8ae3c1-internal-event-v2

Objective
- Define InternalEventV2 to replace the generic payload model while preserving the existing EnvelopeV1.
- Describe the end-to-end message flow and responsibilities of each service.
- Establish a deterministic egress selection policy for candidate replies.

Background
InternalEventV1 uses an envelope plus a generic payload. As cross-service routing and enrichment increases, we require a richer, normalized schema. We keep EnvelopeV1 for correlation, tracing, and routing slip; the new InternalEventV2 adds explicit message, annotations, and candidates collections. This mirrors the attached StandardEventType.jsonc reference while aligning field names to our TypeScript camelCase style.

Design Principles
- Versioned, explicit contracts; no implicit fields.
- Envelope-first: correlationId, traceId, routingSlip live in EnvelopeV1.
- Flat match keys (label/value) for rules engines; retain rich payloads for detail.
- Backward compatibility: V1 remains during migration; V2 preferred for new work.

Contracts

EnvelopeV1 (unchanged)
- v: "1"
- source: string
- correlationId: string
- traceId?: string
- replyTo?: string
- timeoutAt?: string
- egressDestination?: string
- routingSlip?: RoutingStep[]
- user?: { id: string; email?; displayName?; roles?; status? }
- auth?: { v: '1'; provider?; method: 'enrichment'; matched: boolean; userRef?; at: string }

InternalEventV2
- Extends: EnvelopeV1 (flattened; no `envelope` nesting)
- type: InternalEventType
- channel?: string
- userId?: string
- message: MessageV1
- annotations?: AnnotationV1[]
- candidates?: CandidateV1[]
- errors?: ErrorEntryV1[]

MessageV1
- id: string
- role: 'user' | 'assistant' | 'system' | 'tool'
- text?: string
- language?: string
- rawPlatformPayload?: Record<string, any>

AnnotationV1
- id: string
- kind: 'intent' | 'entities' | 'sentiment' | 'topic' | 'custom'
- source: string
- createdAt: string (ISO8601)
- confidence?: number
- label?: string
- value?: string
- score?: number
- payload?: Record<string, any>

CandidateV1
- id: string
- kind: 'text' | 'rich' | 'action' | string
- source: string
- createdAt: string (ISO8601)
- status: 'proposed' | 'selected' | 'superseded' | 'rejected'
- priority: number (lower is higher priority)
- confidence?: number
- text?: string
- format?: 'plain' | 'markdown' | 'html' | string
- reason?: string
- metadata?: Record<string, any>

ErrorEntryV1
- source: string
- message: string
- fatal?: boolean
- at: string (ISO8601)

Example
See planning/reference/StandardEventType.jsonc. Note: snake_case keys (created_at) in external payloads are normalized to camelCase at the TypeScript boundary (createdAt) while parsers may accept both during ingestion.

Message Flow
1) Ingestion
   - Translate external events into InternalEventV2.
   - Populate EnvelopeV1 fields (v, source, correlationId, traceId, replyTo/egressDestination as needed).
   - Build message; preserve original event under message.rawPlatformPayload.

2) Auth Service — User Enrichment
   - Add/update EnvelopeV1.user and EnvelopeV1.auth.
   - Optionally set userId/channel if determinable.
   - Append a routing step with status.

3) Routing Service — Routing Slip Enrichment
   - Compute/update routingSlip and nextTopic decisions.
   - From this point, routingSlip governs downstream path.

4) Post-Router Services
   - Perform one of two generic tasks:
     a) Enrich event with annotations (features used to determine a response).
     b) Produce candidates (reply options) with status "proposed".
   - Update routing step with status and any error context.

5) Egress Policy
   - Select candidate with the lowest numeric priority.
   - Tie-breakers: higher confidence, then earliest createdAt.
   - Mark selected candidate status = "selected".
   - Deliver reply via egressDestination or replyTo as appropriate.
   - If no candidates exist, fall back to existing V1 behavior.

Compatibility & Migration
- InternalEventV1 remains for legacy consumers; InternalEventV2 preferred.
- New type exports will include both V1 and V2.
- Adapters may down-convert V2 to V1 where necessary during transition.

Observability
- Log correlationId, routing step id, status, and changes to annotations/candidates.
- Egress logs selection rationale (priority/confidence/createdAt) and destination.

Validation Strategy
- Unit tests for candidate selection (priority and tie-breakers).
- Type compilation checks for V2.
- Integration smoke test of a V2 event through router → egress.

Decisions
- V2 flattens on EnvelopeV1 to reduce nesting and friction.
- Lowest-priority-wins egress selection with deterministic tie-breakers.
- Annotations are append-only; candidates may change status over lifecycle.

Open Questions
- Schema registry for strict validation? (deferred)
- Standardized candidate kinds beyond text/action? (deferred)

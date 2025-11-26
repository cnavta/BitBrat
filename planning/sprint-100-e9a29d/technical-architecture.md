Title: Technical Architecture – Firestore-backed JsonLogic Routing (event-router)
Status: Draft for review
Sprint: sprint-100-e9a29d
Branch: feature/sprint-100-e9a29d-event-router-routing-system

Objective
- Add a Firestore-backed, JsonLogic-based routing engine to the event-router service.
- On event ingress, evaluate prioritized rules (first-match wins) to assign a RoutingSlip.
- If no rule matches, use a configured default slip.
- Advance the event to the first destination in its RoutingSlip.

Scope
- In scope: rule model and storage, runtime evaluation flow, default slip, advancement to first step, observability notes, testing approach.
- Out of scope: UI for rule management, custom JsonLogic operators (phase 1), production deployment changes.

Decisions
- Rules source: Firestore path "configs/routingRules".
- Priority: numeric (lower number = higher priority).
- Default slip when no rule matches: ["internal.router.dlq.v1"].
- Evaluation engine: json-logic-js (standard operators only for phase 1).
- Cache: in-memory with Firestore realtime listeners (onSnapshot).
- Matching: deterministic, first-match wins, short-circuit.
- RoutingSlip: assigned to event.envelope.routingSlip using existing types in src/types/events.ts.
- Advance: publish to the nextTopic of the first RoutingStep.

Types and Contracts
- Use EnvelopeV1, RoutingStep, InternalEventV1 from src/types/events.ts.
- Each RoutingStep has a status; initialization uses status "PENDING" and attempt 0.

Evaluation Context for JsonLogic
- The evaluator receives a context object derived from the incoming event:
  {
    type: evt.type,
    channel: evt.channel,
    userId: evt.userId,
    envelope: evt.envelope,        // includes correlationId, source, routingSlip (if any)
    payload: evt.payload,          // original event details
    now: new Date().toISOString(), // convenience values
    ts: Date.now()
  }
  Rules can reference nested fields using standard JsonLogic variable access, e.g., { "var": "payload.message" }.

Firestore Data Model (configs/routingRules)
- Document fields:
  - id: string (doc id)
  - enabled: boolean
  - priority: number
  - description?: string
  - logic: object (JsonLogic expression)
  - routingSlip: array of { id: string, v?: string, nextTopic: string, maxAttempts?: number, attributes?: map }
  - metadata?: { createdAt?: string, updatedAt?: string, updatedBy?: string }

Runtime Components
- RuleLoader: warm-load rules on startup, maintain cache, subscribe via onSnapshot, validate and sort by priority.
- JsonLogicEvaluator: evaluate rule.logic against a context derived from InternalEventV1 (type, envelope, payload, channel, userId, now, ts).
- RouterEngine: iterate enabled rules by priority, pick first truthy; else use default; materialize RoutingSlip (status=PENDING), publish to first step nextTopic.

Routing Flow Pseudocode
1. On message from internal.ingress.v1:
   - Build evaluation context from event.
   - For rule in rules (sorted by priority asc):
       - if rule.enabled && jsonLogic(rule.logic, ctx) === true:
           - selectedSlip = clone(rule.routingSlip)
           - break
   - If no match: selectedSlip = defaultSlip
   - Normalize selectedSlip into RoutingStep[]:
       - status = "PENDING", attempt = 0, v = "1" (if undefined)
   - evt.envelope.routingSlip = selectedSlip
   - Publish evt to selectedSlip[0].nextTopic

Example Rule Document (Firestore)
{
  "enabled": true,
  "priority": 10,
  "description": "Route chat commands starting with ! to bot",
  "logic": {
    "and": [
      { "==": [ { "var": "type" }, "chat.command.v1" ] },
      { ">": [ { "var": "payload.text.length" }, 1 ] }
    ]
  },
  "routingSlip": [
    {
      "id": "router",
      "v": "1",
      "status": "PENDING",
      "nextTopic": "internal.llmbot.v1",
      "maxAttempts": 3,
      "attributes": { "origin": "event-router" }
    }
  ]
}

Observability
- Log at debug each decision with { matched, ruleId, priority, selectedTopic }.
- Basic counters: router.events.total, router.rules.matched, router.rules.defaulted. Expose under /_debug/ endpoints on event-router.

Error Handling
- Firestore failures or no rules: fall back to default slip.
- Invalid rule docs: skip and log error.

Testing Strategy (implementation phase)
- Unit: evaluator cases; engine priority/short-circuit; default path.
- Integration: Firestore emulator, sample rules, snapshot updates.
- Bus: mock publisher, assert publish to expected topic.

Open Questions
- Should a constant INTERNAL_ROUTER_DLQ_V1 be added to src/types/events.ts? Proposed value: "internal.router.dlq.v1".
 - Downstream step status transitions: confirm that the receiving service is responsible for marking its own step to OK/ERROR.

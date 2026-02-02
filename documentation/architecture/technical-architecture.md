# Technical Architecture: Phased Implementation

## Routing Slip Pattern
The core mechanism for phase transitions is the **Routing Slip**. The `event-router` acts as the orchestrator, appending or updating a `routingSlip` object within the event metadata.

### Routing Slip Schema (Draft)
```json
{
  "metadata": {
    "correlationId": "uuid-v4",
    "phase": "ingress | enrichment | reaction | egress",
    "routingSlip": {
      "next": "service-name",
      "history": ["service-a", "service-b"],
      "remaining": ["service-c"]
    }
  },
  "payload": {}
}
```

## Phase Transitions

### 1. Ingress to Enrichment
- Services in the **Ingress** phase publish to `internal.ingress.v1`.
- `event-router` consumes `internal.ingress.v1`.
- It analyzes the event type and attaches a routing slip for **Enrichment**.
- Example: Slip might target `auth` then `query-analyzer`.

### 2. Enrichment to Reaction
- After enrichment services complete their work, they publish back to a topic monitored by `event-router` (e.g., `internal.enriched.v1`).
- `event-router` evaluates the enriched metadata.
- If the event should proceed, it assigns a **Reaction** slip (e.g., targeting `llm-bot`).
- If the event is filtered (e.g., by `query-analyzer`), `event-router` may jump directly to **Egress**.

### 3. Reaction to Egress
- The reaction worker (`llm-bot`) produces a response.
- If the routing slip is completed (no more `remaining` steps), the worker publishes the result directly to the appropriate egress topic (e.g., `internal.egress.v1`).
- The `api-gateway` or `ingress-egress` service consumes the message and delivers it to the end user.
- **Note:** The `event-router` is intentionally bypassed for final egress to reduce latency and complexity.

## Routing Rule Strategy
To minimize boilerplate and maintain clarity across phases, routing rules should be categorized by the phase they operate in.

### 1. Phase-Specific Rule Sets
The `event-router` should load different rule sets based on the `metadata.phase` of the incoming event:
- **Ingress Rules:** Focus on mapping event types to initial enrichment chains.
- **Enrichment Rules:** Focus on evaluating enriched metadata (e.g., user roles, intent) to determine if a reaction is needed or if the event should be dropped/bypassed.
- **Reaction Rules:** Focus on selecting the appropriate reaction model or service based on the fully enriched context.

### 2. Minimal Boilerplate Patterns
- **Implicit Phase Context:** Rules should automatically inherit the current phase context, so they only need to specify the *next* steps.
- **Default Transitions:** If no specific rule matches, the system should follow a default phase transition (e.g., Ingress -> Enrichment).
- **Slip-Driven Execution:** Services do not need to know about "phases"; they simply execute the `next` service in their `routingSlip`. The `event-router` is only invoked when the `next` step requires a new routing decision.

## Service Communication
- **Pub/Sub (NATS/Google Cloud PubSub):** Used for all inter-service communication to ensure decoupling.
- **Topic Naming Convention:** `internal.<phase>.<version>`
  - `internal.ingress.v1`
  - `internal.enrichment.v1`
  - `internal.reaction.v1`
  - `internal.egress.v1`

## Implementation Steps (Phased Rollout)

### Step 1: Event Router Enhancement
Update `src/apps/event-router-service.ts` to support the routing slip logic and phase detection.

### Step 2: Service Topic Alignment
Update individual services to publish/consume from phase-specific topics instead of generic ones.
- `auth`: consume `internal.ingress.v1`, publish `internal.enrichment.v1`.
- `llm-bot`: consume `internal.reaction.v1`, publish `internal.reaction.result.v1`.

### Step 3: Persistence Finalization
Update `persistence` service to handle multiple capture points:
- Capture raw ingress.
- Capture finalized egress for audit.

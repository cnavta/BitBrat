# LLM Agent State Memory Architecture

## Graph + Mutation Event Model

**Generated:** 2026-02-18T14:49:55.420020Z

------------------------------------------------------------------------

# 1. Overview

This document defines a production-ready architecture for implementing
LLM agent state memory using a **Graph + Mutation Event** model.

The architecture separates:

-   **State Snapshot** (current truth)
-   **Mutation Log** (append-only event history)
-   **Rule Graph Engine** (reactive derivation + automation)
-   **LLM Tool Interface** (controlled mutation proposals)

This model provides:

-   Deterministic behavior
-   Replayability
-   Observability
-   Safe multi-actor coordination
-   Compatibility with coding agents and automated tooling

------------------------------------------------------------------------

# 2. Architectural Principles

1.  All state changes occur through mutation events.
2.  State is authoritative and externally stored.
3.  The LLM does not hold operational truth in context.
4.  Automation is rule-driven, not prompt-driven.
5.  Every mutation is auditable and attributable.

------------------------------------------------------------------------

# 3. High-Level Architecture

User / Mod / Vision / Automation ↓ LLM Agent ↓ (proposes mutation)
Mutation API Layer ↓ Policy / Validation Engine ↓ Mutation Commit Log ↓
State Snapshot Store ↓ Rule Graph Engine ↓ Action Connectors (OBS,
Twitch, etc.)

------------------------------------------------------------------------

# 4. Core Components

## 4.1 State Snapshot Store

Stores the current authoritative state.

### Requirements

-   Low-latency read/write
-   Versioned updates
-   TTL support
-   Key-level metadata

### Example Schema (Flat Key Model)

``` json
{
  "scene.name": {
    "value": "BRB",
    "updatedAt": "2026-02-18T13:02:00Z",
    "updatedBy": "agent",
    "version": 41
  },
  "stream.state": {
    "value": "on",
    "updatedAt": "2026-02-18T12:58:00Z",
    "updatedBy": "obs",
    "version": 18
  }
}
```

### Recommended Storage Options

-   Redis (fast, pub/sub enabled)
-   Postgres JSONB (durable + transactional)
-   Firestore (if already in GCP ecosystem)

------------------------------------------------------------------------

## 4.2 Mutation Event Log

Append-only store of all changes.

### Mutation Schema

``` json
{
  "id": "uuid",
  "op": "set",
  "key": "scene.name",
  "value": "BRB",
  "actor": "agent",
  "reason": "User requested bio break",
  "expectedVersion": 40,
  "ts": "2026-02-18T13:02:00Z"
}
```

### Guarantees

-   Immutable
-   Ordered
-   Auditable
-   Replayable

------------------------------------------------------------------------

## 4.3 Rule Graph Engine

Reactive engine that processes committed mutations.

### Responsibilities

-   Observe state changes
-   Evaluate conditions
-   Emit actions
-   Optionally emit derived mutations

### Example Rule (YAML DSL)

``` yaml
- id: switch_scene
  when:
    key: scene.name
    op: set
  if:
    state:
      obs.connected: true
  then:
    - action: obs.setScene
      args:
        name: "{ state.scene.name }"
```

------------------------------------------------------------------------

## 4.4 LLM Tool Interface

LLM interacts through constrained tools.

### Read Tools

-   getState(keys\[\])
-   getStatePrefix(prefix)

### Write Tools

-   proposeMutation(op, key, value, reason, ttlSec?)
-   compareAndSet(key, expectedVersion, newValue)

### Discipline Pattern

Every agent turn follows:

1.  Read relevant state.
2.  Decide.
3.  Propose mutation.
4.  Await confirmation (optional).
5.  Respond to user.

------------------------------------------------------------------------

# 5. Concurrency Model

Each state key maintains a version.

Writes include expectedVersion.

If mismatch: - Reject mutation - Return latest version - LLM
re-evaluates

This prevents race conditions between: - LLM - Mods - Vision systems -
Automation bridges

------------------------------------------------------------------------

# 6. TTL + Ephemeral State

Certain signals (e.g., vision detection) are ephemeral.

Example:

``` json
{
  "vision.dead": {
    "value": true,
    "ttlSec": 10,
    "confidence": 0.91
  }
}
```

Derived rules convert unstable signals into stable state when thresholds
are met.

------------------------------------------------------------------------

# 7. Policy Layer

Before committing mutations:

-   Validate key allowlist
-   Validate enum values
-   Validate actor permissions
-   Rate limit disruptive keys

Example protected keys:

-   stream.state
-   stream.end
-   clip.delete

------------------------------------------------------------------------

# 8. Replay + Recovery

To rebuild state:

1.  Load empty snapshot
2.  Replay mutation log in order
3.  Recompute derived state

Optional: periodic snapshot checkpointing for performance.

------------------------------------------------------------------------

# 9. Observability

Emit structured logs for:

-   Proposed mutations
-   Accepted mutations
-   Rejected mutations
-   Rule activations
-   External action results

Correlation IDs should link:

User Message → LLM Decision → Mutation → Rule → Action

------------------------------------------------------------------------

# 10. Security Considerations

-   LLM cannot directly execute side-effecting tools without policy
    validation.
-   All external actions must originate from committed mutations.
-   Secrets never injected into LLM context.

------------------------------------------------------------------------

# 11. Summary

The Graph + Mutation Event architecture provides:

-   Deterministic state management
-   Multi-actor safety
-   LLM containment
-   Auditability
-   Replayability
-   Clean integration with automation systems

This model scales from single-stream automation to distributed
multi-agent orchestration systems.

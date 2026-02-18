# BitBrat Platform: State Memory Architecture

## Graph + Mutation Event Model Implementation

**Drafted:** 2026-02-18
**Status:** Draft / Planning

---

# 1. Overview

This document adapts the **Graph + Mutation Event** model for the BitBrat Platform. It provides a standardized way for LLM agents and platform services to manage persistent, reactive state.

In BitBrat, this architecture enables:
- **Deterministic Agent Memory**: Agents don't rely on context for platform truth.
- **Reactive Automation**: State changes trigger platform actions (e.g., OBS scene switches).
- **Auditability**: Every change is tracked, attributed, and reversible.

---

# 2. BitBrat Architectural Mapping

| Component | Abstract Requirement | BitBrat Implementation |
|-----------|----------------------|-------------------------|
| **State Snapshot Store** | Fast read/write, versioned | **Firestore** (`state` collection) |
| **Mutation Event Log** | Append-only, ordered | **NATS JetStream** (`internal.state.mutation.v1`) + **Firestore** (`mutation_log`) |
| **Rule Engine** | Reactive derivation | **`state-engine` Service** (Node/TS) |
| **LLM Interface** | Controlled tools | **MCP Server** (`state-mcp` or integrated into `llm-bot`) |

---

# 3. Core Components

## 3.1 State Snapshot Store (Firestore)

Authoritative current state is stored in Firestore.

**Collection:** `state`
**Document ID:** `{key}` (e.g., `stream.state`)

**Schema:**
```json
{
  "value": "on",
  "updatedAt": "2026-02-18T13:02:00Z",
  "updatedBy": "obs-mcp",
  "version": 42,
  "ttl": null,
  "metadata": {
    "source": "obs-websocket-event"
  }
}
```

## 3.2 Mutation Event Log (NATS + Firestore)

All state changes MUST be proposed as mutations.

**NATS Topic:** `internal.state.mutation.v1`
**Firestore Collection:** `mutation_log`

**Mutation Payload:**
```json
{
  "id": "uuid-v4",
  "op": "set",
  "key": "stream.state",
  "value": "on",
  "actor": "agent:bot-01",
  "reason": "Detected OBS stream start event",
  "expectedVersion": 41,
  "ts": "2026-02-18T13:02:00Z"
}
```

## 3.3 State Engine (The Rule Engine)

The `state-engine` is a new service that:
1.  **Validates** mutations (Policy Layer).
2.  **Commits** valid mutations to Firestore.
3.  **Publishes** success/failure events.
4.  **Evaluates Rules** reacting to state changes.

**Rule Example (JsonLogic / YAML):**
```yaml
rules:
  - id: on_stream_start
    on: "stream.state == 'on'"
    do:
      - action: "obs.setScene"
        args: { "name": "Live" }
```

## 3.4 LLM Tool Interface (MCP)

`llm-bot` interacts with state through MCP tools:

- `get_state(keys: string[])`: Returns current values and versions.
- `propose_mutation(key, value, reason, expectedVersion?)`: Proposes a change.

---

# 4. First Pass: Stream State Management

The first implementation focuses on `stream.state`.

### Flow:
1.  **OBS Starts**: `obs-mcp` detects stream start -> publishes `internal.state.mutation.v1` with `key: "stream.state", value: "on"`.
2.  **State Engine**: Validates mutation -> Updates Firestore `state/stream.state` -> Publishes success.
3.  **LLM Bot**: Periodically or on-trigger reads `stream.state`. Now knows the stream is ON without guessing.
4.  **Agent Action**: If Agent wants to stop stream, it calls `propose_mutation(key: "stream.state", value: "off")`.
5.  **State Engine**: Validates (e.g., check permissions) -> Updates state -> Triggers Rule -> Publishes `internal.egress.v1` to `obs-mcp` to stop stream.

---

# 5. Security & Policy

- **Key Allowlist**: Only specific keys can be mutated by the Agent.
- **Actor Permissions**: `obs-mcp` can update `stream.state`, but `llm-bot` might need "approver" level for certain keys.
- **Validation**: Enforce enums (e.g., `stream.state` must be `on` or `off`).

---

# 6. Next Steps

1.  **Define Protobuf/TS types** for Mutations and State.
2.  **Implement `state-engine` service** stub.
3.  **Add State MCP tools** to `llm-bot`.
4.  **Bootstrap Firestore** with initial stream state.

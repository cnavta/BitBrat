# Execution Plan: Agent State Memory Implementation

This document outlines the technical execution steps for implementing the **Graph + Mutation Event** model for agent state memory in the BitBrat Platform.

## Phase 1: Foundation & Types
1. **Define Core Schemas**: Create TypeScript interfaces and/or Protobuf definitions for `MutationProposal`, `StateSnapshot`, and `MutationResult`.
2. **Event Topic Setup**: Register `internal.state.mutation.v1` in NATS JetStream configuration.
3. **Firestore Schema**: Provision the `state` and `mutation_log` collections in the development environment.

## Phase 2: state-engine Service Implementation
1. **Service Scaffolding**: Create the `state-engine` service using the shared `BaseServer` and `McpServer` base classes.
2. **Mutation Handler**:
    - Implement a NATS subscriber for `internal.state.mutation.v1`.
    - Implement validation logic (Key allowlist, Actor permissions).
    - Implement the Firestore commit logic with optimistic concurrency (version checking).
3. **MCP Tool Implementation**:
    - Implement `get_state` tool.
    - Implement `get_state_prefix` tool.
    - Implement `propose_mutation` tool.
4. **Rule Engine Stub**: Integrate `json-logic-js` for evaluating simple rules triggered by state changes.

## Phase 3: Integration (Stream State Use Case)
1. **ingress-egress Update**: Update Twitch EventSub handlers to publish mutation proposals instead of raw events for stream status.
2. **llm-bot Integration**:
    - Update `llm-bot` to connect to `state-engine` via MCP.
    - Add logic to check `stream.state` before initiating stream-dependent actions.
3. **obs-mcp Reactive Loop**:
    - Configure `state-engine` rule to emit `internal.egress.v1` events when `stream.state` changes.

## Phase 4: Validation & Testing
1. **Unit Tests**: Test validation rules and mutation logic in `state-engine`.
2. **Integration Tests**: Verify the end-to-end flow from Twitch Event -> `state-engine` -> Firestore -> `llm-bot`.
3. **Performance Check**: Measure latency for state lookups via MCP.

# Implementation Plan – sprint-227-8d4f2c

## Objective
Add a generic egress destination (`internal.egress.v1`) to allow system and derived events to send messages to external systems (Discord, Twitch, Twilio, WebSockets) without requiring an initial request or an instance-specific destination.

## Technical Architecture

### 1. Overview
The platform currently uses instance-specific topics for egress (e.g., `internal.egress.v1.<instanceId>` or `internal.api.egress.v1.<instanceId>`). This works well for responses to specific requests. However, system-generated events or derived events often lack a specific instance to route back to. 

We will introduce a shared topic `internal.egress.v1` that all egress-capable services (`ingress-egress-service` and `api-gateway`) will listen to.

### 2. Service Responsibilities

#### A. Ingress-Egress Service
- **Topic**: Listens to `internal.egress.v1`.
- **Logic**:
    - For each event received, check the `source` or `annotations` to determine if it's a platform it supports (Twitch, Discord, Twilio).
    - If supported, attempt delivery using the appropriate client.
    - If delivery fails (e.g., channel not found, client disconnected), publish to DLQ.
    - If platform NOT supported by this service (e.g., it's a websocket event), it should probably ignore it (or only DLQ if it *should* have handled it but couldn't). 
    - *Correction*: The issue says "Determines if it is targeted from a platform that service supports". If it doesn't support it, it just ignores it. If it *does* support it but fails to deliver, it goes to DLQ.

#### B. API Gateway
- **Topic**: Listens to `internal.egress.v1`.
- **Logic**:
    - Check if the event is targeted at a platform it supports (specifically `websocket`, or if `source` is `api-gateway`, or if it has a `userId` that is currently connected to this gateway instance).
    - If user is connected to THIS instance, deliver via WebSocket.
    - If user is NOT connected to THIS instance, it might be connected to another instance. Since all instances listen to the generic topic, the correct instance will pick it up.
    - Note: To avoid multiple DLQ events for the same message, only the `ingress-egress-service` (which handles the majority of platform-specific egress) or a designated logic should handle DLQ if *no one* picked it up. However, the requirement says "each service determines if it is targeted... if it cannot deliver... it should be published to a DLQ". This implies each service that *thinks* it should handle it but fails, DLQs it.
    - *Refinement for API Gateway*: If `egress.destination === 'api-gateway'` or `source === 'api-gateway'`, and the user is NOT found on ANY instance, it should be DLQ'd. Since instances don't know about other instances' connections easily without a shared state, we'll have each instance check its own connections. If it's targeted for websocket but the user isn't there, it might just ignore it unless we have a way to know it's *definitely* for websocket but *definitely* not connected.

### 3. DLQ Strategy
- **Target**: `internal.deadletter.v1` (or a specific egress DLQ if preferred, but existing services use `internal.deadletter.v1`).
- **Persistence Service**: Listens to the DLQ and updates state to reflect the failure.
- **Criteria for DLQ**: Only when a service *should* have delivered the message but encountered a terminal error (e.g., invalid user ID, platform API error).

## Deliverables
- **Code changes**:
    - `src/apps/ingress-egress-service.ts`: Add subscription to `internal.egress.v1`.
    - `src/apps/api-gateway.ts`: Add subscription to `internal.egress.v1`.
    - `src/services/api-gateway/egress.ts`: Update `EgressManager` to return delivery status or handle DLQ.
    - `src/services/routing/dlq.ts`: Ensure it supports egress failure types.
- **Tests**:
    - Integration tests for generic egress routing.
    - Unit tests for new logic in services.

## Acceptance Criteria
- [ ] `ingress-egress-service` successfully delivers Twitch/Discord/Twilio messages from `internal.egress.v1`.
- [ ] `api-gateway` successfully delivers WebSocket messages from `internal.egress.v1` to connected users.
- [ ] Failed deliveries are published to `internal.deadletter.v1`.
- [ ] System remains backward compatible with instance-specific egress.

## Testing Strategy
- Use local message bus (NATS or PubSub emulator).
- Mock external platform clients (Twitch, Discord, Twilio).
- Verify DLQ contents on failure.

## Definition of Done
- Code adheres to style guide.
- `validate_deliverable.sh` passes.
- PR created and linked in `publication.yaml`.
- Documentation updated.

# Implementation Plan — Sprint 31 — Event Router: Subscribe to internal.ingress.v1

## Objective & Scope
- Implement the initial capability of the event-router service: subscribe to the internal.ingress.v1 topic and log the content of received events.
- Scope limited to subscription and logging; no routing logic or downstream publishing yet.

## Deliverables
- Code: src/apps/event-router-service.ts — add subscriber wiring on startup.
- Tests: src/apps/event-router-service.test.ts — verify subject composition and subscription options.
- Docs: planning/sprint-31-a1b2c3/* (this plan, manifest, request log, validation script).

## Acceptance Criteria
- On service start, event-router subscribes to ${BUS_PREFIX}internal.ingress.v1 using the message-bus abstraction.
- Incoming messages are logged with type, correlationId, attributes, and payload size.
- Jest tests pass and confirm that the subscriber is configured for the correct subject and queue group.

## Testing Strategy
- Unit tests using Jest that mock the message-bus factory and assert the subscription call.
- No external dependencies; logs validated indirectly via handler presence and configuration.

## Deployment Approach
- No deployment in this sprint. Behavior is exercised locally via tests and can run under Docker Compose with NATS in future sprints.
- Code aligns with architecture.yaml and uses BaseServer + message-bus factories.

## Dependencies & External Systems
- Message bus drivers (NATS and Pub/Sub) already implemented in src/services/message-bus.
- BUS_PREFIX, MESSAGE_BUS_DRIVER, NATS_URL envs as defined in architecture.yaml defaults.

## Definition of Done (DoD)
- Code compiles: npm run build
- Tests pass: npm test
- Subscriber uses ${BUS_PREFIX}internal.ingress.v1 and logs receipt
- All new code is TypeScript, follows repo conventions, and includes basic documentation/comments

# Key Learnings – sprint-179-b4e5f6

## Twilio Conversations WebSocket Ingress
- Access Tokens for Conversations must include a `ChatGrant`.
- The Client emits `messageAdded` for all conversations the identity is a participant of, which is ideal for a unified ingress pattern.
- Connection state is tracked via `connectionStateChanged`, while initialization state is tracked via `stateChanged`.

## Jest Mocking Best Practices
- When mocking external modules that need to share variables with the test scope, those variables MUST start with the prefix `mock` to avoid hoisting issues.

## Ingress-Egress Service Architecture
- The existing `ConnectorManager` and `EgressConnector` interfaces are proving to be very robust for adding new platforms with minimal friction.

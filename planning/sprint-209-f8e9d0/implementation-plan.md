# Sprint Execution Plan – sprint-209-f8e9d0

## Objective
Implement the `api-gateway` service to provide a secure, WebSocket-based API for bi-directional event passing with the BitBrat Platform, utilizing the `McpServer` foundation and platform messaging abstractions.

## Scope
- Implementation of the `api-gateway` service entry point.
- Bearer token authentication mechanism integrated with Firestore.
- WebSocket session management and routing.
- Ingress and Egress path implementation using `MessageAdapter` and `EventSelection`.
- Initial set of chat-related events.

## Deliverables
- `src/apps/api-gateway.ts`: Service implementation.
- `src/services/api-gateway/`: Supporting services (auth, routing, etc.).
- `backlog.yaml`: Trackable task list.
- Tests (Unit & Integration).
- Updated documentation.

## Acceptance Criteria
- Service successfully authenticates clients using Bearer tokens from Firestore.
- Clients can send `chat.message.send` and receive `chat.message.received` via WebSockets.
- Messages are correctly published to `internal.ingress.v1`.
- Service correctly subscribes to instance-specific egress topics and routes events to clients.
- `validate_deliverable.sh` passes all checks including build and tests.

## Testing Strategy
- **Unit Tests**:
    - Token validation logic (SHA-256, expiration, caching).
    - Message framing and enrichment.
- **Integration Tests**:
    - End-to-end WebSocket connection and event flow using a test NATS/Firestore setup (emulators).
- **Manual Verification**:
    - Connecting via a WebSocket client (e.g., `wscat`) using a generated token.

## Deployment Approach
- Deploy as a Cloud Run service.
- Use environment variables for `EGRESS_INSTANCE_ID` and other configuration.
- Integrate with GCLB for production traffic.

## Dependencies
- `ws`: WebSocket library.
- `firebase-admin`: For Firestore access.
- Platform common library for `BaseServer`, `McpServer`, and messaging abstractions.

## Definition of Done
- All backlog items marked as `done`.
- Code reviewed and pushed to feature branch.
- PR updated with implementation summary.
- `validate_deliverable.sh` execution report is clean.

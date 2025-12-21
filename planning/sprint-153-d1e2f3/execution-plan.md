# Execution Plan – sprint-153-d1e2f3

This plan details the technical steps for implementing Source State Awareness, as defined in the Technical Architecture.

## Phase 1: Foundation (Contracts & Schema)
Goal: Define the interfaces and storage structure.

- **Task 1.1: Extend `InternalEventV2`**: Update `src/types/events.ts` to include `system.source.status`, `system.stream.online`, and `system.stream.offline` types.
- **Task 1.2: Define Firestore `sources` Schema**: Finalize the TypeScript interface for the `sources` collection document.
- **Task 1.3: Update Persistence Model**: Add `normalizeSourceStatus` and `normalizeStreamEvent` helpers in `src/services/persistence/model.ts`.

## Phase 2: Ingress Connectivity Heartbeats
Goal: Ensure `ingress-egress` reports its own health.

- **Task 2.1: Implement Heartbeat Logic**: Add a periodic timer in `ingress-egress` service to loop through active connectors and call `getSnapshot()`.
- **Task 2.2: Publish Status Events**: Map `ConnectorSnapshot` to `system.source.status` and publish to `internal.ingress.v1`.
- **Task 2.3: Handle State Changes**: Ensure immediate publication when a connector enters `ERROR` or `DISCONNECTED` state.

## Phase 3: Twitch Stream Lifecycle
Goal: Capture when the stream starts and stops.

- **Task 3.1: Subscribe to EventSub**: Update `TwitchEventSubClient` to subscribe to `stream.online` and `stream.offline` topics.
- **Task 3.2: Map Twitch Events to Internal Events**: Create an adapter to convert Twitch EventSub payloads to `InternalEventV2` behavioral events.
- **Task 3.3: Publish to Internal Bus**: Route these events to `internal.ingress.v1`.

## Phase 4: State Persistence
Goal: Update Firestore with incoming system events.

- **Task 4.1: Extend `PersistenceStore`**: Add `upsertSourceState` method to handle `sources` collection updates.
- **Task 4.2: Update Subscription Handler**: Modify the `PersistenceServer` to route `system.*` events to the new `upsertSourceState` method.
- **Task 4.3: Implement Metrics Aggregation**: Ensure `messagesIn`/`messagesOut` (already partially tracked) are aggregated into the source document.

## Phase 5: Enhanced Metrics (P1/P2)
Goal: Provide deeper insights into source health.

- **Task 5.1: Auth Health Tracking**: Detect token expiration in `ingress-egress` and emit status update.
- **Task 5.2: Viewer Count Updates**: Periodically update `metadata` with viewer count from Twitch API during `ONLINE` status.
- **Task 5.3: Permission Detection**: Query and store bot roles (Mod/VIP).

## Acceptance & Validation
- Run `validate_deliverable.sh` to ensure all files are present and formatted.
- Execute integration tests for Firestore transitions.
- Manual verification via `/_debug/twitch` endpoint if updated.

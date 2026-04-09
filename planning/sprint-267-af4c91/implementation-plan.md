# Implementation Plan – sprint-267-af4c91

## Objective
- Implement the TA-recommended persistence model that stores a compact aggregate at `events/{correlationId}` and immutable lifecycle snapshots at `events/{correlationId}/snapshots/{snapshotId}`.
- Replace the current mutable `EventDocV1`-oriented approach with clean, forward-looking contracts and storage behavior.

## Scope
- Define and implement new persistence types for the aggregate document, snapshot document, and snapshot event envelope.
- Update the persistence service to create initial snapshots from `internal.ingress.v1`, consume a new `internal.persistence.snapshot.v1` topic, append immutable snapshots, and maintain aggregate pointers and counters.
- Update producers at delivery boundaries to publish full final snapshot events with delivery metadata.
- Introduce shared snapshot publishing support for optional intermediate update snapshots.
- Update architecture and configuration artifacts required by the new snapshot flow.
- Add and update tests covering new persistence flows, idempotency, aggregate projection updates, and terminal error handling.

## Out of Scope
- Backward compatibility shims for legacy types beyond what is minimally required to keep the platform operable during implementation.
- Broad historical data migration of already-persisted Firestore event records.
- New UI, reporting, or query APIs beyond the aggregate/query surface already implied by persistence storage.
- Multi-region or non-Firestore persistence redesigns.

## Deliverables
- Persistence domain types for aggregate and immutable snapshots.
- Snapshot event contract and topic constants.
- Persistence service/store/model refactor for aggregate + snapshot writes.
- Final snapshot publication from `ingress-egress` and `api-gateway`.
- Optional shared snapshot publisher helper for intermediate updates.
- Architecture/configuration updates in `architecture.yaml` and env handling.
- Automated tests for ingress capture, finalization, deadletter snapshots, idempotency, and aggregate state maintenance.
- Sprint planning artifacts, verification notes, and validation updates required by the sprint protocol.

## Acceptance Criteria
- A new persistence contract exists for immutable snapshot writes and compact aggregate projection updates.
- `internal.ingress.v1` processing creates an aggregate document plus an immutable `initial` snapshot containing the full `InternalEventV2`.
- Final delivery boundaries publish a full `internal.persistence.snapshot.v1` event with `kind = final` and delivery metadata.
- Persistence consumes snapshot events and appends immutable `update`, `final`, or `deadletter` snapshots without duplicating already-applied idempotent messages.
- Aggregate documents maintain `initialSnapshotId`, `latestSnapshotId`, optional `finalSnapshotId`, `snapshotCount`, current status, delivery/deadletter summary, and projected current fields.
- TTL is applied consistently to both aggregate and snapshot documents.
- Architecture and configuration documentation reflect the new topic and snapshot-related policy knobs.
- Automated tests for the new persistence behavior pass.

## Testing Strategy
- Add unit tests around new model helpers for aggregate creation, snapshot derivation, projection updates, and idempotency handling.
- Add store-level tests for transactional sequence assignment, duplicate snapshot no-op behavior, TTL propagation, and aggregate pointer maintenance.
- Add/update service-level tests covering ingress capture, snapshot consumption, final snapshot processing, and deadletter handling.
- Run the directly affected persistence and publisher test suites during implementation; expand to broader affected modules if integration behavior changes.

## Deployment Approach
- Keep the deployment model aligned to `architecture.yaml`: Cloud Run services, Firestore persistence, and event-driven topic choreography remain unchanged.
- Update `architecture.yaml` additively for `internal.persistence.snapshot.v1` consumption/publication and new snapshot-related environment variables.
- Preserve existing Cloud Build / Cloud Run deployment patterns; no infrastructure target change is planned.

## Dependencies
- Firestore transaction support for aggregate and snapshot writes.
- Existing canonical `InternalEventV2` contract in `src/types/events.ts`.
- Delivery boundary services (`ingress-egress`, `api-gateway`, and potentially `BaseServer`) exposing full event state when publishing snapshots.
- Message bus topic configuration consistent with `architecture.yaml`.

## Risks and Design Notes
- Snapshot growth must be bounded by configurable retention and maximum payload policies.
- Optional intermediate snapshot capture should be policy-driven to avoid excessive volume.
- The legacy finalize topic may need temporary coexistence during rollout, but new authoritative final state must come from the snapshot topic.
- Aggregate projection logic must stay intentionally compact and derived from snapshot content rather than becoming a second full event record.

## Definition of Done
- The deliverable satisfies the repository-wide DoD in `AGENTS.md`, including code quality, tests, deployment artifact alignment, documentation, and traceability to this sprint.
- `architecture.yaml` remains the canonical behavior source and all implementation details stay aligned to it or are proposed as additive updates.
- No implementation work begins until this plan is explicitly approved by the user.

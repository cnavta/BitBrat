# Sprint Execution Plan – sprint-154-e4f5g6

## 1. Overview
This plan outlines the implementation steps for enabling DLQ processing in the `persistence` service. This will allow the system to record terminal failures in the event store, providing better visibility and traceability.

## 2. Implementation Phases

### Phase 1: Contract & Model Alignment (Tasks BL-001, BL-002)
- **Goal**: Update the project infrastructure definition and data models to support DLQ events.
- **Steps**:
    1. Update `architecture.yaml` to add `internal.deadletter.v1` and `internal.router.dlq.v1` to the `persistence` service's consumed topics.
    2. Extend `EventDocV1` in `src/services/persistence/model.ts` with the `deadletter` field as specified in the technical architecture.
    3. Implement `normalizeDeadLetterPayload` in `model.ts` to handle the conversion of DLQ events into a database patch.

### Phase 2: Persistence Logic (Task BL-003)
- **Goal**: Implement the core logic for updating the event store with failure information.
- **Steps**:
    1. Add `applyDeadLetter` method to `PersistenceStore`.
    2. Ensure the method correctly identifies the original document via `correlationId`.
    3. Set `status: 'ERROR'`, populate `deadletter` context, and update `finalizedAt` and `ttl`.

### Phase 3: Service Integration (Task BL-004)
- **Goal**: Wire up the new logic to the `persistence` service message loop.
- **Steps**:
    1. Update `src/apps/persistence-service.ts` to include the new topics in the subscription list.
    2. Add handlers for the new topics that invoke `store.applyDeadLetter`.

### Phase 4: Validation (Task BL-005)
- **Goal**: Ensure the implementation is correct and doesn't break existing functionality.
- **Steps**:
    1. Write unit tests for `PersistenceStore.applyDeadLetter` using mocks for Firestore.
    2. Create `validate_deliverable.sh` to run the build and test suite.
    3. Verify that the `persistence` service can still process normal ingress and finalization events.

## 3. Rollout Strategy
1. **Local Development**: Implement and test using local emulator or mocks.
2. **Feature Branch**: All work performed on `feature/sprint-154-e4f5g6-dlq-error-handling`.
3. **PR & Review**: Submit PR for review once validation passes.

## 4. Risks & Mitigations
- **Risk**: High volume of DLQ events could overwhelm the persistence service.
- **Mitigation**: Persistence is already designed for high-throughput ingress; DLQ updates are similar in load to finalization updates.
- **Risk**: Missing `correlationId` in DLQ event.
- **Mitigation**: `applyDeadLetter` should log a warning and skip processing if `correlationId` is absent.

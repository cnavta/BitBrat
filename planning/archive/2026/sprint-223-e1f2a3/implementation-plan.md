# Execution Plan – sprint-223-e1f2a3

## Objective
Enhance `event-router` service to support `message` and `candidates` enrichments, with random selection logic for candidates and state persistence in Firestore.

## Execution Strategy

### Phase 1: Foundation & Schema (BB-223-01, BB-223-02)
- Update `RuleDoc` interface in `rule-loader.ts` to include the `enrichments` object.
- Enhance `validateRule` and `sanitizeAnnotations` (or add `sanitizeEnrichments`) to handle the new structure.
- Define `IStateStore` in `router-engine.ts`.
- Implement `FirestoreStateStore` in `event-router-service.ts` (or a common resource location if appropriate, but keeping it local to `event-router` for now as it's service-specific state).

### Phase 2: Core Logic (BB-223-03, BB-223-04)
- Refactor `RouterEngine.route` to `async`.
- Implement `enrichments.message` logic: create `MessageV1` and attach to `evtOut.message`.
- Implement `enrichments.annotations` logic: append to `evtOut.annotations`.
- Implement `randomCandidate` logic:
    - If `randomCandidate` is false, append all `enrichments.candidates`.
    - If true, fetch `lastCandidateId` from `IStateStore`, filter candidates, pick random, and update store.

### Phase 3: Integration & Testing (BB-223-05, BB-223-06)
- Update `EventRouterServer` ingress handler to `await engine.route(...)`.
- Update all existing unit tests in `src/services/routing/__tests__/` to be `async`.
- Add new test cases for `message` enrichment and `randomCandidate` selection.
- Create an integration test to verify Firestore state persistence.

## Deliverables
- `src/services/router/rule-loader.ts`
- `src/services/routing/router-engine.ts`
- `src/apps/event-router-service.ts`
- `src/services/routing/__tests__/*.spec.ts`
- `planning/sprint-223-e1f2a3/trackable-backlog.yaml`

## Acceptance Criteria
- [ ] `RuleDoc` correctly parses `enrichments` from Firestore.
- [ ] Events matched by rules with `enrichments.message` have the message text applied.
- [ ] Events matched by rules with `enrichments.candidates` and `randomCandidate: true` have exactly one candidate from the set, and it differs from the last one used for that user/rule.
- [ ] All tests pass and project builds.

## Definition of Done
- All code changes trace back to sprint-223-e1f2a3.
- `validate_deliverable.sh` passes.
- PR created and linked in manifest.

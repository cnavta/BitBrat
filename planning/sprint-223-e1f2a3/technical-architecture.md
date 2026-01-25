# Technical Architecture: Event Router Enrichments (Sprint 223)

## Objective
Enhance the `event-router` service to support new enrichment types: `message` and `candidates`. Transition from top-level `annotations` in `RuleDoc` to a consolidated `enrichments` property.

## Proposed Changes

### 1. RuleDoc Schema Update
Update `RuleDoc` interface in `src/services/router/rule-loader.ts` to use the new `enrichments` structure.

```typescript
export interface RuleDoc {
  id: string;
  enabled: boolean;
  priority: number;
  description?: string;
  logic: string;
  routingSlip: RoutingStepRef[];
  enrichments: {
    message?: string;
    annotations?: AnnotationV1[];
    candidates?: CandidateV1[];
    randomCandidate?: boolean;
  }
  metadata?: Record<string, unknown>;
}
```

### 2. RuleLoader Enhancements
Update `validateRule` in `src/services/router/rule-loader.ts`:
- Handle the `enrichments` property from raw Firestore data.
- Transition existing top-level `annotations` to `enrichments.annotations` if found (or simply expect the new structure as legacy support is not required).
- Sanitize `message`, `annotations`, and `candidates` within the `enrichments` object.

### 3. RouterEngine Logic
Update `RouterEngine.route` in `src/services/routing/router-engine.ts`:
- Change `route` to be `async` to support stateful candidate selection.
- When a rule matches:
    - Apply `enrichments.annotations` (if present) by appending to `evtOut.annotations`.
    - Apply `enrichments.message`:
        - Create a `MessageV1` instance.
        - Set `text` to `enrichments.message`.
        - Set `role` to `assistant` (or appropriate default for rule-generated messages).
        - Add or replace `evtOut.message` with this instance.
    - Apply `enrichments.candidates`:
        - If `randomCandidate` is `true`:
            - Use a `IStateStore` to retrieve the `lastCandidateId` for this `(userId, ruleId)`.
            - Select a random candidate from `enrichments.candidates` that is NOT the `lastCandidateId`.
            - Update the `lastCandidateId` in the `IStateStore`.
            - Append the selected candidate to `evtOut.candidates`.
        - Else:
            - Append all `enrichments.candidates` to `evtOut.candidates`.

### 4. State Persistence
- Introduce `IStateStore` interface in `src/services/routing/router-engine.ts`.
- Implement `FirestoreStateStore` in `src/apps/event-router-service.ts` (or a dedicated service file).
- Storage location: `users/{userId}/routerState/{ruleId}`.
- Field: `lastCandidateId` (string).

### 5. Dependency Injection
- Pass `IStateStore` to `RouterEngine` constructor.
- In `event-router-service.ts`, instantiate `RouterEngine` with a `FirestoreStateStore`.
- In unit tests, use a `MockStateStore`.

## Verification Plan
- **Unit Tests**:
    - `RouterEngine`: Verify message and candidate enrichment logic (including randomization and state interaction).
    - `RuleLoader`: Verify correct parsing of `enrichments` property.
- **Integration Tests**:
    - Verify end-to-end routing from ingress to publish with enrichments applied.
- **Manual Verification**:
    - Deploy to a development environment and verify enrichment of live events.

# Sprint Execution Plan – sprint-157-8d2f3a

## Objective
Implement a feature-flag-controlled LLM prompt logging mechanism that captures full prompt text and responses into Firestore for analysis and prompt engineering improvement.

## Execution Strategy

### Phase 1: Configuration & Foundation
- Update `feature-flags.manifest.json` to include the new `llm.promptLogging.enabled` flag.
- Verify Firestore connectivity and ensure the `prompt_logs` collection is ready for writes (service account permissions).

### Phase 2: Implementation (Core Logic)
- Modify `src/services/llm-bot/processor.ts` within the `call_model` node of the StateGraph.
- Implement the logging logic using `getFirestore()` from `../../common/firebase`.
- Apply existing `redactText` logic to ensure PII/sensitive data is handled according to project standards.
- Use a "fail-soft" approach where logging errors are caught and logged as warnings but do not interrupt the LLM response flow.

### Phase 3: Validation & Testing
- Create a unit test in `tests/services/llm-bot/prompt-logging.test.ts` to verify:
    - No logging occurs when the feature flag is `false`.
    - Logging occurs with correct schema when the feature flag is `true`.
    - Errors in Firestore writing do not crash the processor.
- Update `validate_deliverable.sh` (or create a sprint-specific one) to include these tests.

## Risk Mitigation
- **Performance**: We will use asynchronous Firestore writes. While the pseudo-code suggests `await`, we will ensure it's wrapped in a way that minimizes impact on the user-facing latency if possible, or accept the minor overhead as specified in the architecture.
- **Cost**: The feature flag allows us to turn this off easily if Firestore write volume/costs become a concern.

## Deliverables
- [ ] Updated `src/common/feature-flags.manifest.json`
- [ ] Modified `src/services/llm-bot/processor.ts`
- [ ] New unit tests for prompt logging
- [ ] Updated `request-log.md`
- [ ] Validated `validate_deliverable.sh`

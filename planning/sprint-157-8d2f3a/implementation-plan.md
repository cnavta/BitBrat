# Implementation Plan – sprint-157-8d2f3a

## Objective
- Implement full text logging of LLM prompts and responses to Firestore for analysis and optimization, controlled by a feature flag.

## Scope
- Centralized feature flag configuration.
- LLM Bot processor modification to capture and log prompt/response pairs.
- Firestore integration for persistence.
- Correlation ID inclusion for cross-referencing.

## Deliverables
- `src/common/feature-flags.manifest.json`: New `llm.promptLogging.enabled` flag.
- `src/services/llm-bot/processor.ts`: Logic to log to Firestore when the flag is enabled.
- `tests/services/llm-bot/prompt-logging.spec.ts`: Unit tests for the logging logic.
- `validate_deliverable.sh`: Updated to include new tests.

## Acceptance Criteria
- Feature flag `llm.promptLogging.enabled` (env `FF_LLM_PROMPT_LOGGING`) controls the logging behavior.
- When enabled:
    - A document is created in Firestore collection `prompt_logs` for each LLM interaction.
    - Document contains `correlationId`, `prompt` (full text), `response` (full text), `model`, and `createdAt`.
- When disabled:
    - No Firestore writes occur for prompt logging.
- Error handling: If Firestore logging fails, the main LLM flow should NOT be interrupted (fail-soft).

## Testing Strategy
- **Unit Tests**:
    - Mock `FeatureGate` to toggle the flag.
    - Mock Firestore `collection` and `add` methods.
    - Verify that `add` is called with correct data when flag is ON.
    - Verify that `add` is NOT called when flag is OFF.
- **Integration Tests**:
    - Verify the feature flag is correctly read from environment variables.

## Deployment Approach
- Standard Cloud Build and Cloud Run deployment.
- Feature flag defaults to `false` in all environments.

## Dependencies
- Google Cloud Firestore (already initialized in the project).
- `src/common/feature-flags.ts` for toggle logic.

## Definition of Done
- Code adheres to project style.
- All tests pass (`npm test`).
- `validate_deliverable.sh` executes successfully.
- Documentation updated (this plan and technical architecture).
- PR created and linked in `publication.yaml`.

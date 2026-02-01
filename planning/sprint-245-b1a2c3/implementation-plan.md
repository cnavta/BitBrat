# Implementation Plan – sprint-245-b1a2c3

## Objective
- Add prompt processing time to `llm-bot` and `query-analyzer` `prompt_logs` in Firestore.

## Scope
- `src/services/llm-bot/processor.ts`: Measure `generateText` duration and log it.
- `src/services/query-analyzer/llm-provider.ts`: Measure `generateObject` duration and log it.

## Deliverables
- Code changes in `llm-bot` and `query-analyzer`.
- Updated Firestore log schema (implicit).
- Verification tests.

## Acceptance Criteria
- `prompt_logs` collection for `llm-bot` contains `processingTimeMs`.
- `prompt_logs` collection for `query-analyzer` contains `processingTimeMs`.
- Units are in milliseconds.

## Testing Strategy
- Unit tests to verify that `processingTimeMs` is calculated and passed to the logger/Firestore.
- Smoke test via `validate_deliverable.sh`.

## Deployment Approach
- Standard Cloud Run deployment (dry-run for validation).

## Dependencies
- Firestore access (already present).

## Definition of Done
- Code adheres to project style.
- Tests pass.
- `validate_deliverable.sh` succeeds.
- PR created.

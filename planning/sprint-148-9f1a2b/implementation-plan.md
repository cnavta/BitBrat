# Implementation Plan – sprint-148-9f1a2b

## Objective
- Fix Cloud Run deployment failures caused by special characters/quotes in environment variables.

## Scope
- `cloudbuild.oauth-flow.yaml`: Refactor the `Cloud Run deploy (conditional)` step to use bash arrays for `gcloud` command assembly instead of string concatenation and `eval`.

## Deliverables
- Modified `cloudbuild.oauth-flow.yaml`.
- `validate_deliverable.sh`: Updated or new script to verify the logic.

## Acceptance Criteria
- `gcloud run deploy` command is assembled correctly even when environment variables contain spaces and single quotes.
- `eval` is removed in favor of direct execution using bash array expansion `"${CMD_ARGS[@]}"`.

## Testing Strategy
- Create a test script that mocks `gcloud` and verifies that it receives the correct arguments when `LLM_BOT_SYSTEM_PROMPT` contains single quotes and spaces.

## Definition of Done
- Code changes implemented.
- Logic verified via script.
- PR created.

# Implementation Plan – sprint-258-7e3f2a

## Objective
- Fix regression in `TwitchEventSubClient`'s stream.online event handler tests.
- Fix timing issue in `LLMProvider` logs test.

## Scope
- `src/services/ingress/twitch/__tests__/eventsub-client.repro.spec.ts`
- `tests/services/query-analyzer/llm-provider.test.ts`
- `src/services/ingress/twitch/eventsub-client.ts` (if needed)

## Deliverables
- Corrected test cases for `TwitchEventSubClient`.
- Corrected test case for `LLMProvider`.

## Acceptance Criteria
- Both failing tests pass consistently.
- No other tests are broken.

## Testing Strategy
- Run the specifically failing tests using Jest.
- Run the full test suite for `ingress` service.
- Verify that `TwitchEventSubClient` properly handles online events in the real application (by manual inspection/verification if possible, though this is a test fix).

## Deployment Approach
- Standard CI/CD pipeline.

## Dependencies
- None.

## Definition of Done
- All tests pass.
- `validate_deliverable.sh` script created and passes.
- PR created.
- Verification report and retro created.

# Implementation Plan – sprint-225-a1b2c3

## Objective
- Resolve the issue where the JsonLogic rule for `!lurk` fails to match when the message text is exactly `!lurk`.
- Change the handling of empty `routingSlip` arrays in `RuleDoc` so they are sent to egress instead of DLQ.

## Scope
- Investigation of `jsonlogic-evaluator.ts` and `router-engine.ts`.
- Bug reproduction through unit tests.
- Bug fix for the matching logic or recommendation for rule update.
- Logic update for empty `routingSlip` handling in `RouterEngine`.
- Validation of the fix.

## Deliverables
- Reproduction test cases.
- Fix for the matching logic.
- Logic update for empty routing slip.
- Updated `verification-report.md`.
- `validate_deliverable.sh` script.

## Acceptance Criteria
- A message with text `!lurk` must match the provided JsonLogic rule when `config.commandSigil` is `!`.
- If a matching rule has an empty `routingSlip` array, the message should be routed to egress (`internal.egress.v1`) instead of DLQ.

## Testing Strategy
- Add a new unit test in `src/services/router/__tests__/jsonlogic-evaluator.spec.ts` that uses the specific rule from the issue description.
- Test with and without trailing spaces in the message.
- Test with different `commandSigil` values.

## Deployment Approach
- N/A (Code fix/Logic update).

## Dependencies
- Existing `json-logic-js` and project test suite.

## Definition of Done
- All tests pass.
- `validate_deliverable.sh` succeeds.
- PR created.
- Sprint artifacts (manifest, log, verification, retro) completed.

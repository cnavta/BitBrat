# Implementation Plan - sprint-185-tw-join

## Objective
Remediate issues with the Twilio bot not joining all conversations by expanding the webhook handler to include `onMessageAdded` as a fallback join trigger.

## Scope
- Update `ingress-egress-service.ts` webhook handler.
- Update `architecture.yaml` documentation for Twilio setup.
- Verify idempotency of bot join logic.

## Deliverables
- Code changes in `ingress-egress-service.ts`.
- Updated test coverage for fallback join logic.
- Sprint verification report and retro.

## Acceptance Criteria
- Webhook handles `onMessageAdded` event.
- If `onMessageAdded` is received and bot is not a participant, bot is added via REST API.
- Logic is idempotent and handles "Already a participant" errors gracefully.
- All existing Twilio tests pass.

## Testing Strategy
- Mock Twilio webhook requests with `onMessageAdded`.
- Verify REST API call to add participant is made.
- Regression test `onConversationAdded`.

## Definition of Done
- All code committed and pushed.
- `validate_deliverable.sh` passes.
- PR created.

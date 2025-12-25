# Implementation Plan – sprint-166-a2b3c4

## Objective
- Fix the issue where 'VIP' role added in Firestore is not appearing in enriched chat events.

## Scope
- `src/services/auth/enrichment.ts`: fix role merging logic.
- `src/services/auth/user-repo.ts`: harden role merging logic in `ensureUserOnMessage`.

## Deliverables
- Bug fix in enrichment and user-repo.
- Reproduction test case.
- Updated validation script.

## Acceptance Criteria
- User with manually added 'VIP' role in Firestore (via email) preserves that role even when a new platform-specific document is created.
- Platform roles (subscriber, moderator, etc.) are merged with existing Firestore roles.

## Testing Strategy
- Unit test with mocked repository to reproduce the email-match scenario.
- Run existing enrichment and repository tests.

## Definition of Done
- Code passes all tests.
- `validate_deliverable.sh` passes.
- PR created.

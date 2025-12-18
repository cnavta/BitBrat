# Implementation Plan – sprint-141-9b1a72

## Objective
- Implement Auth User Enrichment v1 to populate EnvelopeV1.user.notes and EnvelopeV1.user.tags, and to create/update Firestore user docs per ingress provider.

## Scope
- In scope:
  - Auth/Enrichment service logic to read/write Firestore users/*
  - Session boundary logic: 24h inactivity => new session
  - Event-time tags: NEW_USER, FIRST_ALLTIME_MESSAGE, FIRST_SESSION_MESSAGE, RETURNING_USER
  - Populate envelope.user and envelope.auth
  - Firestore rules updates (if needed)
  - Tests (unit + emulator integration)
- Out of scope:
  - Cross-provider identity linking/merging
  - Downstream behavior changes beyond reading new fields

## Deliverables
- Code changes in auth/enrichment service
- Tests: unit and integration (Firestore emulator)
- Documentation: technical-architecture.md (this sprint)
- Validation: sprint validate_deliverable.sh invoking repo validator

## Acceptance Criteria
- New Firestore user doc is created on first-seen per provider
- EnvelopeV1.user.notes populated from user doc when present
- Tags set per rules; session-based FIRST_SESSION_MESSAGE respects 24h inactivity
- auth metadata present: { v: '1', provider, method: 'enrichment', matched, userRef, at }
- All tests pass locally and in CI

## Testing Strategy
- Unit tests: tagging and session boundary decisions
- Integration: create vs update paths with Firestore emulator, counters, and timestamps
- Contract: schema conformance of envelope augmentation

## Deployment Approach
- Standard CI: build, test; no runtime changes beyond service update
- Cloud Run deployment via existing pipelines (no changes expected)

## Dependencies
- Firestore emulator for local tests
- Access to Firestore in runtime environments

## Definition of Done
- Meets project-wide DoD and this plan’s Acceptance Criteria
- All tests pass, docs updated, and validations green

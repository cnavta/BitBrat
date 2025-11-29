# Implementation Plan – sprint-103-9b6393e

## Objective
- Deliver Observability, Hardening, and Integration Tests for the event-router routing system.

## Scope
- In scope
  - /_debug/ counters HTTP endpoint in event-router
  - Error handling improvements in routing components (skip invalid rules, fallback on Firestore failures)
  - Firestore emulator-backed integration tests for snapshot reactivity
- Out of scope
  - New infrastructure beyond emulator usage
  - UI for rule management

## Deliverables
- planning/sprint-103-9b6393e/trackable-backlog.yaml (authoritative sprint backlog)
- /_debug/ endpoint and counter instrumentation
- Hardened routing error paths with unit tests
- Integration test suite against Firestore emulator

## Acceptance Criteria
- validate_deliverable.sh passes logically (build, tests, local up/down, dry-run)
- /_debug/ returns JSON counters that update on message handling
- Invalid rule docs are skipped gracefully; Firestore failures default to DLQ slip without crashing
- Integration tests demonstrate onSnapshot update reactivity and rerouting

## Testing Strategy
- Unit tests: counters increment, error path coverage (invalid docs, failures)
- Integration tests: Firestore emulator with sample rules; verify routing changes after updates
- Bus publisher mocked where applicable; HTTP tested with supertest or similar

## Deployment Approach
- Default runtime: Cloud Run (per project standards)
- Build/deploy via Cloud Build configurations already present
- No new IaC changes for this sprint; reuse existing templates

## Dependencies
- firebase-admin and Firestore emulator
- jest/ts-jest; supertest (for endpoint tests)

## Definition of Done
- Adheres to architecture.yaml and project-wide DoD
- No TODOs in production paths
- Jest tests included and passing
- Documentation for /_debug/ and emulator testing added/updated as needed

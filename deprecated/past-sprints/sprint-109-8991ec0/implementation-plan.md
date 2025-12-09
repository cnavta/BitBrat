# Implementation Plan – sprint-109-8991ec0

## Objective
- Convert event-router to operate natively on InternalEventV2 (no V1 round-trip), preserving RouterEngine behavior and observability.

## Scope
- In scope
  - event-router ingress normalization to V2
  - compatibility with RouterEngine (evaluate rules using equivalent context)
  - publish V2 with routingSlip
  - tests, logs, counters, validation script alignment
- Out of scope
  - Global refactor of other services beyond adapter use
  - Rule storage schema changes

## Deliverables
- Code changes
  - src/apps/event-router-service.ts (V2-native path)
  - Possible minor adjustments in src/services/routing/router-engine.ts or local adapter
- Tests
  - New tests for V2 path behavior
- CI/Validation
  - ensure validate_deliverable.sh covers new tests
- Docs
  - Update routing docs and verification report

## Acceptance Criteria
- Event-router accepts V2 and up-converts V1 to V2 only once
- RouterEngine decisions identical to current behavior for equivalent events
- Published messages are V2; attributes derived from V2
- Tests pass in CI

## Testing Strategy
- Unit tests for routing decisions using V2 inputs
- Integration-style test mocking message bus publisher
- Golden comparison for selected topics vs current baseline

## Deployment Approach
- Standard Node build/test; Cloud Run deploy path unchanged
- No production env variable changes required

## Dependencies
- Existing Message Bus interfaces, RuleLoader, and adapters

## Definition of Done
- Meets Project DoD and AGENTS.md protocol
- validate_deliverable.sh logically passable
- PR created or failure logged per Publication Rules

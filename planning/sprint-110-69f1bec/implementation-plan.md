# Implementation Plan – sprint-110-69f1bec

## Objective
- Improve message publishing performance, resilience, and observability across drivers by applying recommendations from planning/reference/messaging-system-improvements.md. No business behavior changes outside publishing semantics.

## Scope
- In scope
  - Message bus drivers (Pub/Sub, NATS) publish path behavior and configuration
  - Attribute normalization and observability for publishers
  - Shared backoff defaults and helper utilities
  - Documentation and validation script alignment
- Out of scope
  - Consumer-side business logic changes outside publishing semantics
  - Cross-service refactors beyond message-bus and docs

## Deliverables
- Code changes
  - pubsub-driver.ts: ensure strategy, timeout, batching defaults, structured logging
  - nats-driver.ts: structured logging, flush behavior, attribute normalization reuse
  - index.ts: shared attribute normalization helper exposure
  - common retry/backoff utility and constants (if introduced this sprint)
- Tests
  - Jest unit tests for attribute normalization, publish logging, timeout behavior (mocked)
- Documentation
  - documentation/messaging-config.md: environment toggles, batching defaults, idempotency guidance
- Planning artifacts
  - trackable-backlog.yaml, sprint-manifest.yaml, request-log.md, verification-report.md, publication.yaml, retro.md, key-learnings.md

## Acceptance Criteria
- Attributes (correlationId, type, traceparent, stepId?) normalized and identical across drivers
- Pub/Sub publishing respects timeout and ensure strategy; retries once on NotFound when enabled
- Explicit batching defaults are set and logged
- Observability: structured logs emitted for publish start/ok/error and flush
- Tests pass locally via validate_deliverable.sh

## Testing Strategy
- Unit tests with jest mocks for drivers; no real network calls
- Mock timers to simulate timeouts; verify error tagging for deadlines
- Verify attribute normalization helper using table-driven cases

## Deployment Approach
- No deployment in this sprint; changes integrate into existing Docker/Cloud Build pipelines. Refer to architecture.yaml for runtime environment. Future sprints may enable canary publish tests.

## Dependencies
- None external; relies on existing @google-cloud/pubsub and nats packages available in repository

## Definition of Done
- Aligned with project-wide DoD: tests in Jest, docs updated, validate_deliverable.sh logically passable, changes traceable to this sprint.

# Implementation Plan – sprint-132-a13b2f

## Objective
- Establish a clear plan to implement the Persistence Service that:
  - Consumes events from internal.ingress.v1 and persists them in Firestore
  - Consumes internal.persistence.finalize.v1 to update the final state of previously saved events
  - Lays groundwork for future capabilities (embedding generation, richer indexing)

## Scope
### In scope (this and subsequent implementation sprints)
- Service architecture and boundaries aligned with architecture.yaml
- Firestore data model and collections for events and indexes
- Message consumers and idempotent persistence/update logic
- Observability: structured logging, basic metrics hooks
- Configuration and environment validation
- Unit/integration test scaffolding with mocks
- Cloud Build/Run deployment scaffolding (templates/IaC alignment)

### Out of scope (deferred to later sprints)
- Embedding generation and semantic search indices
- Advanced query endpoints and analytics surfaces
- Cross-region replication and advanced retention policies

## Deliverables
- Persistence service implementation in src/apps/persistence-service.ts and supporting modules under src/services/persistence/*
- Firestore schema and read/write helpers under src/common or src/services/persistence
- Topic consumers for internal.ingress.v1 and internal.persistence.finalize.v1 wired through BaseServer messaging
- Tests (unit and light integration with mocks)
- Deployment artifacts updates as needed (Cloud Build, Dockerfile.persistence already present)
- Documentation updates (README/service notes)

## Acceptance Criteria
- Given a valid InternalEventV2 on internal.ingress.v1, then a new event document is created in Firestore with correlationId, type, timestamps, and raw payload; operation is idempotent.
- Given an internal.persistence.finalize.v1 message referencing a stored event, then the event document is updated with final status, egress metadata, and completion timestamp; operation is idempotent and tolerant of out-of-order arrival.
- Logging includes correlationId and destination for all message receptions and write results.
- Env vars required by BaseServer and Firestore are validated at startup; missing vars fail fast with clear errors.

## Testing Strategy
- Unit tests for:
  - Event normalization and document key generation
  - Idempotency guards (e.g., upsert semantics)
  - Finalization update logic
- Integration tests (mocked Firestore client and messaging):
  - Persist on ingress
  - Update on finalize
- Mocks/stubs for external services; no live Firestore/network in CI.

## Deployment Approach
- Cloud Run deployment per deploymentDefaults in architecture.yaml
- Use existing Dockerfile.persistence and add Cloud Build config if missing
- Ensure instance-based billing alignment
- No external secrets; use env var wiring consistent with other services

## Dependencies
- Firestore (emulator/local for tests; managed in GCP for deployment)
- Messaging substrate provided by BaseServer implementation
- Existing logging facade in BaseServer

## Definition of Done
- All acceptance criteria met
- Tests pass in CI
- validate_deliverable.sh updated to exercise build/test or, for planning-only sprint, verify structure and lint
- Documentation added/updated
- Changes traceable to sprint-132-a13b2f in request-log.md

## Implementation Phases (high-level)
1. Define data model and helper library for Firestore documents
2. Implement consumer for internal.ingress.v1 with persistence logic and idempotency
3. Implement consumer for internal.persistence.finalize.v1 with update logic
4. Tests and observability
5. Deployment scripts and configs
6. Documentation and validation

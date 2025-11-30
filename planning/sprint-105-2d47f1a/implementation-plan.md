# Implementation Plan – sprint-105-2d47f1a

## Objective
- Implement the Auth service (User Enrichment v1) per the approved technical architecture (sprint-104-f0bef1b).
- The service will:
  - Subscribe to internal.ingress.v1
  - Enrich events with user data from Firestore when a userId or email is present
  - Always forward the event to internal.user.enriched.v1 (or AUTH_ENRICH_OUTPUT_TOPIC override), even when unmatched

## Scope
In scope:
- Event contracts alignment (InternalEventV1) and envelope enrichment (envelope.user, envelope.auth)
- Firestore users collection read access and lookups (doc id by userId; email fallback)
- Message bus subscription/publish via existing abstraction
- Environment variables and configuration handling
- Observability (structured logs, counters, debug endpoints)
- Error handling policy (ack/nack) and idempotence
- Testing: unit, integration (emulator), and contract tests
- Minimal deployment glue aligned with architecture.yaml (Cloud Run runtime assumptions)

Out of scope (this sprint):
- Provisioning Firestore and IAM changes
- Writing/updating user documents (read-only in v1)

## Deliverables
- Code
  - src/services/auth/enrichment.ts (pure enrichment decision logic)
  - src/services/auth/user-repo.ts (Firestore reads: by id + email fallback)
  - src/apps/auth-service.ts (subscription wiring, publish path, metrics, logs)
  - Minor additions to src/common/firebase.ts (configure by FIREBASE_DATABASE_ID if needed)
- Tests
  - Unit tests for enrichment logic and handler paths
  - Contract tests for envelope.user/auth shapes
  - Integration test using Firestore emulator for id and email lookup
- Deployment & CI artifacts
  - Ensure validate_deliverable.sh covers build and tests
  - No infra provisioning changes required; relies on existing build/deploy scripts
- Documentation
  - README/service notes
  - IAM read-only expectations for users collection

## Acceptance Criteria
- Service subscribes to ${BUS_PREFIX}${INTERNAL_INGRESS_V1} and publishes to ${BUS_PREFIX}${AUTH_ENRICH_OUTPUT_TOPIC || INTERNAL_USER_ENRICHED_V1}
- Given envelope.user.id matches a Firestore user doc:
  - envelope.user populated with { id, email?, displayName?, roles?, status? }
  - envelope.auth = { v:'1', method:'enrichment', matched:true, userRef, at, provider? }
- Given no id but an email matches, enrichment occurs via email fallback
- Given neither matches or identifiers are absent, envelope.auth.matched=false and event is forwarded
- Logs: info for subscription start/stop and publish results; debug for enrichment outcomes (matched, identifiers, userRef, output subject)
- Counters: auth.enrich.total, auth.enrich.matched, auth.enrich.unmatched, auth.enrich.errors; exposed via /_debug/counters
- Error handling:
  - JSON parse errors: ack (no retry)
  - Firestore transient errors: nack with requeue
  - Publish errors: nack with requeue
- Config/env:
  - AUTH_ENRICH_OUTPUT_TOPIC override honored
  - BUS_PREFIX honored
  - FIREBASE_DATABASE_ID binds Firestore DB if provided
- Tests pass (unit + contract); emulator test runs locally

## Testing Strategy
- Unit tests (Jest):
  - enrichment.spec.ts: matched by id, matched by email fallback, unmatched/no identifiers
  - handler.spec.ts: JSON parse error → ack; Firestore/read error → nack(requeue); publish error → nack(requeue)
  - config.spec.ts: env var handling for output topic and prefix
- Contract tests:
  - auth-envelope.spec.ts asserts exact keys and shapes for envelope.user/auth in matched/unmatched cases
- Integration (local):
  - auth-enrichment-emulator.spec.ts seeds emulator with sample users and verifies end-to-end enrichment paths (with in-memory/mocked bus)

## Deployment Approach
- Runtime: Node 24.x on Cloud Run (managed), consistent with architecture.yaml
- Message bus: Use existing driver abstraction; no driver-specific code in business logic
- Topics: internal.ingress.v1 and internal.user.enriched.v1 must exist in the active driver environment
- No public endpoints required beyond default health/debug endpoints from BaseServer

## Dependencies
- Firestore access via firebase-admin (read-only to users collection)
- Environment variables: LOG_LEVEL, MESSAGE_BUS_DRIVER, NATS_URL (if nats), BUS_PREFIX, AUTH_ENRICH_OUTPUT_TOPIC?, FIREBASE_DATABASE_ID?
- Downstream router expects internal.user.enriched.v1 as default input per sprint-104 notes

## Definition of Done
- Adheres to architecture.yaml and sprint-104 technical architecture
- No TODOs in production paths; error handling implemented
- Jest tests for all new behavior; CI builds/tests pass
- validate_deliverable.sh is logically passable (build + test steps)
- Documentation updated; IAM notes included
- Traceability: planning artifacts (this plan + backlog) committed and referenced

## Execution Plan (High-Level Steps)
1) Implement user-repo Firestore lookups (by id; email fallback)
2) Implement enrichment function (pure)
3) Wire auth-service subscription and publishing with error handling
4) Add logs, counters, debug endpoint
5) Write unit + contract tests
6) Write integration test with emulator (local)
7) Documentation + validation script alignment

# Implementation Plan – sprint-104-f0bef1b

## Objective
- Produce a Technical Architecture document for the Auth service that:
  - Consumes events from internal.ingress.v1
  - Looks up a user by identifier in Firestore (users collection), primary key envelope.user.id; fallback envelope.user.email
  - Enriches the event envelope with user info if found
  - Publishes the (possibly enriched) event to internal.user.enriched.v1, overridable via AUTH_ENRICH_OUTPUT_TOPIC
- Change the event router’s default input topic to internal.user.enriched.v1 (overridable via ROUTER_DEFAULT_INPUT_TOPIC)

## Scope
- In scope:
  - Author technical architecture document covering contracts, Firestore schema, env vars, error handling, observability, deployment, testing
  - Planning artifacts (sprint directory, manifest, validation script skeleton, verification report, etc.)
  - Minimal code/config change to set router default input topic to internal.user.enriched.v1 with env override and tests
- Out of scope:
  - Implementing full Auth enrichment service logic (code) beyond documentation
  - Provisioning Firebase/Firestore or Pub/Sub topics

## Deliverables
- planning/sprint-104-f0bef1b/technical-architecture-auth-service.md
- Updated architecture.yaml for topics (auth publishes internal.user.enriched.v1, router consumes it by default)
- Code change in src/apps/event-router-service.ts and tests
- planning artifacts: sprint-manifest.yaml, implementation-plan.md, request-log.md, validate_deliverable.sh, verification-report.md, publication.yaml, retro.md, key-learnings.md

## Acceptance Criteria
- The architecture doc clearly specifies the flow, contracts, schemas, env vars, error handling, logging, metrics, security, deployment and testing guidance
- Router default input topic changed to internal.user.enriched.v1 with ROUTER_DEFAULT_INPUT_TOPIC override
- Tests pass validating default and env override
- Validation script is logically passable

## Testing Strategy
- Unit tests for router default topic selection and env override
- Integration tests using existing router mocks to confirm subscription subject and publish path remain functional

## Deployment Approach
- No live deployment in this sprint. Document Cloud Run + Pub/Sub integration based on architecture.yaml. Ensure env vars are documented for future deploy.

## Dependencies
- Firebase project with Firestore (documented only)
- Pub/Sub topics internal.ingress.v1 and internal.user.enriched.v1 (documented only)

## Definition of Done
- All deliverables checked in on a feature branch with passing tests and PR created per AGENTS.md
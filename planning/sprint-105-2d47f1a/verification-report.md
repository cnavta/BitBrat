Deliverable Verification - sprint-105-2d47f1a

Completed
- Auth enrichment core logic implemented (Firestore lookup by id; email fallback)
- Message bus wiring (subscribe internal.ingress.v1; publish internal.user.enriched.v1 with override)
- Observability: structured logs, in-memory counters, /_debug/counters endpoint
- Error handling policy: JSON parse -> ack; Firestore/publish errors -> nack(requeue)
- Config/env support: AUTH_ENRICH_OUTPUT_TOPIC, BUS_PREFIX, FIREBASE_DATABASE_ID
- Documentation: documentation/auth-service.md (behavior, env vars, IAM notes)
- CI/Test stability: noop message-bus driver; CI-safe Jest settings; validation script enforces zero-I/O in tests
- PR created and recorded in publication.yaml (https://github.com/cnavta/BitBrat/pull/9)

Partial
- Contract tests for exact envelope.user/auth shapes (unit coverage exists via enrichment.spec.ts; dedicated contract test can be added)
- Handler-level tests for auth-service subscription ack/nack paths (core logic covered; end-to-end handler tests partially deferred)

Deferred
- Firestore emulator integration test for enrichment (planned; not required to ship core behavior this sprint)

Alignment Notes
- Event contracts extended per sprint-104 architecture (envelope.user, envelope.auth)
- Router default input remains internal.user.enriched.v1; pipeline ingress -> auth -> router validated by tests
- Validation script is logically passable: install, build, test, local up/down, infra dry-run included

Known Deviations
- None impacting production paths. Some test coverage deferred to a follow-up sprint if needed.

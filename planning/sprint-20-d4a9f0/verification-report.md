Deliverable Verification Report — Sprint 20 (sprint-20-d4a9f0)

Completed as Implemented
- [x] Schema structures for infrastructure.resources (object-store/cloud-storage and load-balancer/global-external-application-lb) — tools/brat/src/config/schema.ts
- [x] Routing validations (XOR service vs bucket; service exists; bucket/default_bucket references correct resource type) — tools/brat/src/config/schema.ts
- [x] Deprecation behavior: prefer routing when lb.services[] co-exists; emit warning — tools/brat/src/config/schema.ts
- [x] Metadata collection for referenced services and buckets — tools/brat/src/config/schema.ts
- [x] Unit tests covering valid/invalid cases and warnings — tools/brat/src/config/schema.routing.test.ts
- [x] Planning artifacts updated and indexed — planning/sprint-20-d4a9f0/*

Partial or Mock Implementations
- [ ] None. All Sprint 20 scope items are implemented and tested. Provisioning and synth work are out-of-scope for this sprint (scheduled for Sprints 21–23).

Additional Observations
- The importer backend-existence guard was hardened to avoid false negatives in tests; this is non-breaking and improves resilience.
- Root validate_deliverable.sh already runs Jest tests; no CI wiring changes were required for this sprint.

Validation Summary
- Local Validation (2025-11-18 14:30):
  - npm install: OK
  - npm run build: OK
  - npm test: OK (including new schema.routing test suite)
- CI/Dry-run: Root validate_deliverable.sh includes the Jest test step and infra dry-run commands; no changes required this sprint. Execution depends on PROJECT_ID being provided in the environment.

Links
- Plan: planning/sprint-20-d4a9f0/sprint-execution-plan.md
- Backlog: planning/sprint-20-d4a9f0/backlog.md
- Publication: planning/sprint-20-d4a9f0/publication.yaml
- Manifest: planning/sprint-20-d4a9f0/sprint-manifest.yaml

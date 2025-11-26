Sprint 20 — Trackable Backlog

Sprint ID: sprint-20-d4a9f0
Role: Lead Implementor
Source of Truth: architecture.yaml
Related Plan: planning/sprint-20-d4a9f0/sprint-execution-plan.md

Notes
- Status markers: [ ] = not started, [*] = in progress, [x] = done
- Each task includes acceptance criteria and traceability to code/tests.

[x] S20-T1: Schema — Define infrastructure.resources shapes
- Acceptance Criteria:
  - Schema supports resources entries for object-store (implementation=cloud-storage) and load-balancer (implementation=global-external-application-lb)
  - JSDoc documents all fields and defaults; aligns with architecture.yaml
- Traceability:
  - Code: tools/brat/src/config/schema.ts
  - Tests: tools/brat/src/config/schema.routing.test.ts

[x] S20-T2: Schema — Routing model and rule structure
- Acceptance Criteria:
  - Load-balancer.routing supports default_domain, optional default_bucket, and rules[] with path_prefix, optional rewrite_prefix, and exactly one of service or bucket
  - Parsing of representative fixtures succeeds
- Traceability:
  - Code: tools/brat/src/config/schema.ts
  - Tests: tools/brat/src/config/schema.routing.test.ts (valid cases)

[x] S20-T3: Validation — XOR target (service vs. bucket)
- Acceptance Criteria:
  - Each rule validates exactly one of service or bucket; both-or-neither triggers clear errors with rule index
- Traceability:
  - Code: tools/brat/src/config/schema.ts (refinement)
  - Tests: tools/brat/src/config/schema.routing.test.ts (invalid cases)

[x] S20-T4: Validation — service references
- Acceptance Criteria:
  - service must reference a top-level service id in architecture.yaml; missing id throws; inactive id logs a warning (non-fatal)
- Traceability:
  - Code: tools/brat/src/config/schema.ts (cross-ref helper)
  - Tests: tools/brat/src/config/schema.routing.test.ts

[x] S20-T5: Validation — bucket references
- Acceptance Criteria:
  - bucket and default_bucket must reference infrastructure.resources entries of type object-store with implementation=cloud-storage; wrong type or missing ref fails with explicit message
- Traceability:
  - Code: tools/brat/src/config/schema.ts
  - Tests: tools/brat/src/config/schema.routing.test.ts

[x] S20-T6: Metadata — collect referenced services/buckets
- Acceptance Criteria:
  - Parsing yields a metadata object listing unique referenced service ids and bucket keys for downstream synth
- Traceability:
  - Code: tools/brat/src/config/schema.ts (exported helper/types)
  - Tests: tools/brat/src/config/schema.routing.test.ts (assert collected sets)

[x] S20-T7: Deprecation behavior — prefer routing over lb.services[]
- Acceptance Criteria:
  - When lb.services[] exists and a routing-driven load-balancer resource is present, schema parse emits a deprecation warning and prefers routing semantics
- Traceability:
  - Code: tools/brat/src/config/schema.ts (warning hook)
  - Tests: tools/brat/src/config/schema.routing.test.ts (warn case)

[x] S20-T8: Test suite — valid/invalid fixtures
- Acceptance Criteria:
  - Tests cover: service-only, bucket-only, mixed, default_bucket
  - Invalid: both targets set, missing refs, wrong resource type
- Traceability:
  - Tests: tools/brat/src/config/schema.routing.test.ts

[x] S20-T9: Documentation updates
- Acceptance Criteria:
  - Inline JSDoc in schema updated; references to planning docs added
  - Execution plan and backlog confirmed under planning/sprint-20-d4a9f0
- Traceability:
  - Docs: planning/sprint-20-d4a9f0/sprint-execution-plan.md, this backlog

[x] S20-T10: CI/Validation wiring
- Acceptance Criteria:
  - Root validate_deliverable.sh runs Jest tests successfully
  - No runtime behavior changes beyond schema parsing; safe in CI
- Traceability:
  - Scripts: validate_deliverable.sh
  - Evidence: CI logs in future verification report

Validation Procedure
1) Local: npm ci && npm run build && npm test — passing as of 2025-11-18
2) CI/Local dry-run: Root ./validate_deliverable.sh includes npm test; no changes required this sprint

Traceability
- Mirrors the “Sprint 20” section of planning/sprint-17-f7c3a2/implementation-plan-lb-routing-from-infrastructure-resources.md
- Aligns with planning/sprint-17-f7c3a2/technical-architecture-lb-routing-from-infrastructure-resources.md and architecture.yaml
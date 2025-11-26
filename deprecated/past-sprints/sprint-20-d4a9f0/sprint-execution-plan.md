Sprint 20 - Execution Plan

Sprint ID: sprint-20-d4a9f0
Role: Lead Implementor
Source of Truth: architecture.yaml
Upstream References:
- planning/sprint-17-f7c3a2/technical-architecture-lb-routing-from-infrastructure-resources.md
- planning/sprint-17-f7c3a2/implementation-plan-lb-routing-from-infrastructure-resources.md (Sprint 20 section)

Objective & Scope
- Extend the configuration schema to model load-balancer routing and object-store resources, and validate cross-references among services, buckets, and routing.
- Establish clear deprecation behavior for legacy lb.services[] when routing-driven load-balancer resources exist.

Out of Scope
- Buckets provisioning (Sprint 21).
- LB synth changes and assets proxy handling (Sprint 22).
- URL map renderer/importer changes (Sprint 23).
- Migration and CI expansion (Sprint 24).

Deliverables
1) Config schema structures and validations
- File: tools/brat/src/config/schema.ts
- Add structures for infrastructure.resources entries with types:
  - object-store with implementation=cloud-storage (buckets)
  - load-balancer with implementation=global-external-application-lb (routing model)
- Add routing validation rules:
  - Each rule must specify exactly one target: service XOR bucket
  - service must reference a top-level service id (warn if inactive)
  - bucket and default_bucket must reference an object-store with implementation=cloud-storage
- Deprecation behavior:
  - If lb.services[] exists and a routing-driven load-balancer resource is present, prefer routing and emit a deprecation warning.
- Derive/collect referenced service ids and bucket keys for downstream synth (metadata helpers only; no synth in this sprint).

2) Unit tests for schema and validations
- File: tools/brat/src/config/schema.routing.test.ts
- Valid cases:
  - service-only rules
  - bucket-only rules
  - mixed rules
  - default_bucket present with bucket routes
- Invalid cases:
  - both service and bucket set on one rule
  - missing service/bucket references
  - wrong resource type (bucket references non-cloud-storage resource)
- Deprecation warning surfaced when both lb.services[] and routing-driven load-balancer exist.

Acceptance Criteria
- Parsing valid examples succeeds and produces collected references for downstream stages.
- Invalid examples fail with clear, actionable error messages indicating exact rule/index and problem.
- When both lb.services[] and resources-based routing are present, a deprecation warning is emitted and routing is preferred.

Testing Strategy
- Jest unit tests located alongside schema code: tools/brat/src/config/schema.routing.test.ts
- Ensure tests run under root npm test target and in CI via validate_deliverable.sh.
- Use focused assertions; avoid coupling to unrelated schema sections. Normalize dynamic data in test fixtures as needed.

Deployment Approach
- No provisioning or applies in this sprint. Documentation and tests only.
- Changes are confined to schema parsing/validation and tests; no runtime changes to synth/import behavior yet.

Dependencies & External Systems
- architecture.yaml for canonical types and overlay shapes.
- None required at runtime beyond Node/Jest for tests.

Definition of Done (DoD)
- Schema structures and cross-reference validations implemented with inline JSDoc.
- Deprecation behavior implemented and covered by tests.
- Jest tests pass locally and in CI.
- This execution plan and the trackable backlog are committed under planning/sprint-20-d4a9f0.

Risks & Mitigations
- Risk: Over-validation blocks future extensions.
  - Mitigation: Keep validation scoped to fields required by Sprints 21-23; avoid assumptions beyond documented structures.
- Risk: Legacy consumers depend on lb.services[].
  - Mitigation: Prefer routing only when routing-driven load-balancer resource exists; emit clear deprecation warnings.

Traceability
- Implements "Sprint 20 - Schema and Cross-Reference Validation" from the Sprint 17 planning docs listed above.
- Aligns with architecture.yaml infrastructure.resources for load-balancer and object-store entries.

LLM Prompt Annotations
- llm_prompt: Derived from Issue - "Start Sprint 20; create Sprint Execution Plan and Trackable Backlog for Schema and Cross-Reference Validation."

Trackable Backlog
The authoritative backlog is maintained here:
- planning/sprint-20-d4a9f0/backlog.md

A snapshot of initial items is provided in that file with IDs S20-T1..S20-T10.
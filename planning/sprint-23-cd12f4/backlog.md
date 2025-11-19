# Sprint 23 Backlog — URL Map Renderer and Importer Enhancements

Sprint ID: sprint-23-cd12f4
Role: Lead Implementor
Source: architecture.yaml
Upstream: planning/sprint-17-f7c3a2/technical-architecture-lb-routing-from-infrastructure-resources.md

Legend
- Type: [Story|Task|Chore|Spike]
- Est: story points
- Dep: dependencies by ID

Backlog Items

BI-23-001 — Renderer reads routing exclusively — Done ✓
- Type: Story
- Est: 3
- Description: Update tools/brat/src/lb/urlmap/renderer.ts to source routes only from infrastructure.resources.<lb>.routing.
- Acceptance Criteria:
  - Ignores lb.services[] even if present (routing wins).
  - Handles empty rules gracefully and emits be-default when no services and no default_bucket.
- Dep: —

BI-23-002 — Bucket rules -> be-assets-proxy with rewrite — Done ✓
- Type: Story
- Est: 5
- Description: For any rule with bucket or when default_bucket is set, render to backend be-assets-proxy and add urlRewrite embedding the bucket key per proxy contract.
- Acceptance Criteria:
  - YAML contains urlRewrite path prefix with bucket key embedded.
  - Mixed routing (service + bucket) renders correctly.
- Dep: BI-23-001

BI-23-003 — Default backend selection rules — Done ✓
- Type: Story
- Est: 2
- Description: Implement default backend logic: if default_bucket, choose be-assets-proxy; else first be-<service> if any; else be-default.
- Acceptance Criteria:
  - Unit tests assert default selection across scenarios.
- Dep: BI-23-001, BI-23-002

BI-23-004 — Importer backend guard includes assets proxy — Done ✓
- Type: Story
- Est: 3
- Description: Extend tools/brat/src/lb/importer/importer.ts guard to check be-assets-proxy and all referenced be-<service> before import.
- Acceptance Criteria:
  - Non-prod import proceeds only if required backends exist.
  - Prod runs drift detection only with clear log guidance.
- Dep: BI-23-001 .. BI-23-003

BI-23-005 — Renderer unit tests — Done ✓
- Type: Task
- Est: 3
- Description: Add tests at tools/brat/src/lb/urlmap/__tests__/renderer.routing.test.ts covering bucket-only, service-only, and mixed routing.
- Acceptance Criteria:
  - Snapshots verify backend targets and urlRewrite correctness.
- Dep: BI-23-001 .. BI-23-003

BI-23-006 — Importer guard tests — Done ✓
- Type: Task
- Est: 3
- Description: Add tests at tools/brat/src/lb/importer/__tests__/importer.guard.test.ts verifying assets proxy inclusion and environment policy.
- Acceptance Criteria:
  - Fails import when backends missing in non-prod; drift-only in prod.
- Dep: BI-23-004

BI-23-007 — Write YAML to expected path — Done ✓
- Type: Task
- Est: 2
- Description: Ensure renderer writes to infrastructure/cdktf/lb/url-maps/<env>/url-map.yaml and normalizes dynamic fields for tests.
- Acceptance Criteria:
  - File path and contents verified in unit tests.
- Dep: BI-23-001 .. BI-23-003

BI-23-008 — Logging & deprecation notes — Partial *
- Type: Chore
- Est: 1
- Description: Ensure logs clearly state routing-only source and reference schema deprecation of lb.services[].
- Acceptance Criteria:
  - Log lines present in renderer/importer pathways.
- Dep: —

BI-23-009 — Validation & PR publication — Done ✓
- Type: Task
- Est: 2
- Description: Run validate_deliverable.sh locally/CI; create feature branch and PR with links to sprint docs per protocol.
- Acceptance Criteria:
  - CI green; PR includes links to sprint-execution-plan.md and backlog.md.
- Dep: All above

Notes
- Focus tests on stable keys; normalize timestamps/random IDs.
- Treat architecture.yaml as canonical; no hardcoded env/project values.

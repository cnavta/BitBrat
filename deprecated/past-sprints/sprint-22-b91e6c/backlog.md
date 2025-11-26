# Sprint 22 — Trackable Backlog

Sprint ID: sprint-22-b91e6c
Role: Lead Implementor
Related Plan: planning/sprint-22-b91e6c/sprint-execution-plan.md
Source of Truth: architecture.yaml

Notes
- This backlog operationalizes the Sprint 22 objective from the planning documents under sprint-17-f7c3a2.
- Estimates are rough and used to prioritize. Testing tasks are first‑class items.

Backlog Items

[x] S22-001 — Parse routing model in synthLoadBalancerTf
- Description: Read infrastructure.resources.<lb>.routing (default_domain, default_bucket, rules[]) in tools/brat/src/providers/cdktf-synth.ts.
- Acceptance:
  - Given a config containing routing, the function extracts referenced service ids and detects presence of any bucket routing or default_bucket.
  - Service references are cross-checked against architecture.yaml services, capturing active status for each referenced service id.
  - No backends are created in this step; just derivation and return structure prepared for subsequent steps.
- Dependencies: None (uses validated schema from Sprint 20).
- Estimate: 2 pts
  Evidence:
  - Implemented in tools/brat/src/providers/cdktf-synth.ts (routing extraction, active service cross-check)
  - Covered by routing tests fixtures

[x] S22-002 — Derive unique referenced services set
- Description: From routing.rules[].service collect a de-duplicated, ordered set of service ids.
- Acceptance:
  - Duplicates are removed; order is stable by first appearance in rules[] to determine default backend later.
  - Only services with services[serviceId].active === true are included; inactive or unknown services are ignored.
- Dependencies: S22-001
- Estimate: 1 pt
  Evidence:
  - deriveUniqueServices() in tools/brat/src/providers/cdktf-synth.ts de-duplicates and filters to active services

[x] S22-003 — Per‑region Serverless NEGs for referenced services
- Description: For each referenced service and each targeted region, synthesize google_compute_region_network_endpoint_group targeting Cloud Run service.
- Acceptance:
  - NEG names follow existing naming conventions.
  - Regions come from deploymentDefaults/overlay (consistent with existing provider patterns).
  - No NEGs are created for services that are not active: true.
- Dependencies: S22-002
- Estimate: 3 pts
  Evidence:
  - google_compute_region_network_endpoint_group resources synthesized per referenced service in default region

[x] S22-004 — Backend Services be-<service> with logging enabled
- Description: For each referenced service, create google_compute_backend_service with logging enabled and attach the regional NEGs.
- Acceptance:
  - Each backend service is named be-<service> and references all NEGs for that service across regions.
  - Logging configuration is enabled.
  - No backend services are created for inactive services.
- Dependencies: S22-003
- Estimate: 2 pts
  Evidence:
  - google_compute_backend_service with log_config { enable = true } created and NEGs attached

[x] S22-005 — Assets Proxy NEGs and be-assets-proxy when bucket routing exists
- Description: If routing has any bucket target or default_bucket, create per‑region NEGs for assets-proxy Cloud Run service and a be-assets-proxy backend service.
- Acceptance:
  - NEGs and backend for assets-proxy are only present when bucket routing/default_bucket exists.
  - Names follow convention; backend attaches the assets-proxy NEGs.
- Dependencies: S22-001
- Estimate: 3 pts
  Evidence:
  - Conditional synthesis of neg-assets-proxy-* and be-assets-proxy implemented

[x] S22-006 — Default backend selection logic
- Description: Choose default backend as the first service backend when any service exists; otherwise fall back to be-default (existing behavior).
- Acceptance:
  - Default is deterministic and matches first referenced service.
  - No change to ip/cert mode behavior; URL Map scaffold remains with ignore_changes.
- Dependencies: S22-004
- Estimate: 1 pt
  Evidence:
  - Default URL map backend set to first referenced service when present; else be-default

[x] S22-007 — Outputs: backendServiceNames and negNames
- Description: Expose lists of synthesized backend service names and NEG names for downstream consumers/tests.
- Acceptance:
  - Outputs include be-assets-proxy and its NEGs when synthesized.
  - Ordering is stable and documented in tests.
- Dependencies: S22-004, S22-005
- Estimate: 1 pt
  Evidence:
  - Outputs added in load-balancer main.tf template generation

[x] S22-008 — Unit tests: service-only routing snapshot
- Description: Snapshot test that only referenced services produce NEGs and backends; no assets-proxy present.
- Acceptance:
  - tools/brat/src/providers/cdktf-synth.loadbalancer.routing.test.ts contains a service-only fixture and stable snapshot.
  - Includes a case where routing references an inactive service; verify it produces no NEGs/backends.
- Dependencies: S22-004
- Estimate: 2 pts
  Status Notes (2025-11-18 to 2025-11-19):
  - Implemented in tools/brat/src/providers/cdktf-synth.loadbalancer.routing.test.ts
  - Fixed failing assertions by aligning fixtures to schema (load-balancer resource requires `ip`).
  - Evidence: `npm test` now passes 31/31 suites; this case validates active-only services and absence of assets-proxy.

[x] S22-009 — Unit tests: bucket-only routing snapshot
- Description: Snapshot test that synthesizes only assets-proxy NEGs/backend when default_bucket or bucket rules exist; no service backends.
- Acceptance:
  - Snapshot includes be-assets-proxy and its NEGs; default backend falls back correctly.
  - Any inactive service references present in routing are ignored.
- Dependencies: S22-005, S22-006
- Estimate: 2 pts
  Status Notes (2025-11-18 to 2025-11-19):
  - Implemented and corrected by adding required `ip` field under `resources.main-load-balancer` in the fixture.
  - Evidence: Snapshot asserts presence of be-assets-proxy/NEG and default backend be-default; suite now green.

[x] S22-010 — Unit tests: mixed routing snapshot
- Description: Snapshot test that includes both service backends (for referenced services) and assets-proxy when any bucket route exists.
- Acceptance:
  - Snapshot shows union of service backends and assets-proxy; default backend is the first service backend.
  - Inactive services referenced in routing do not appear in outputs.
- Dependencies: S22-004, S22-005, S22-006
- Estimate: 2 pts
  Status Notes (2025-11-18 to 2025-11-19):
  - Updated fixture to include `ip` on LB resource; expectations now match synthesis behavior.
  - Evidence: Confirms union of service backends + assets-proxy and default backend = first referenced service. All tests pass.

[x] S22-011 — Documentation/JSDoc updates
- Description: Add inline documentation to synthLoadBalancerTf describing routing-driven derivation and assets-proxy conditions.
- Acceptance:
  - Clear comments link back to planning/technical docs; deprecation of lb.services[] reiterated.
- Dependencies: S22-001..S22-006
- Estimate: 1 pt
  Evidence:
  - Added detailed header comments and dry-run guidance in synthLoadBalancerTf

[x] S22-012 — Dry-run verification notes
- Description: Document how to run cdktf synth and terraform plan locally for LB module; ensure no production changes occur.
- Acceptance:
  - Instructions included in test descriptions or a short README note in comments; CI wiring remains as-is until Sprint 24.
- Dependencies: S22-004..S22-010
- Estimate: 1 pt
  Evidence:
  - Dry-run and plan instructions embedded in synthLoadBalancerTf comments

Deliverable Mapping
- Code: tools/brat/src/providers/cdktf-synth.ts (S22-001..S22-007, S22-011)
- Tests: tools/brat/src/providers/cdktf-synth.loadbalancer.routing.test.ts (S22-008..S22-010)
- Docs: JSDoc/comments in provider, this backlog, sprint-execution-plan.md (S22-011, S22-012)

Definition of Done for Sprint 22
- All items S22-001..S22-012 implemented and reviewed.
- Jest tests pass and snapshots stable.
- Dry-run plan confirms only referenced backends for active services and conditional assets-proxy.
- Plan/backlog committed under planning/sprint-22-b91e6c

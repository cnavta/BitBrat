Sprint 22 - Execution Plan — LB Synth: Routing-Driven Backends and Assets Proxy

Sprint ID: sprint-22-b91e6c
Role: Lead Implementor
Source of Truth: architecture.yaml
Upstream References:
- planning/sprint-17-f7c3a2/technical-architecture-lb-routing-from-infrastructure-resources.md
- planning/sprint-17-f7c3a2/implementation-plan-lb-routing-from-infrastructure-resources.md (Sprint 22 section)

Objective & Scope
- Update the Load Balancer synthesis to be routing-driven:
  - Generate Serverless NEGs and Backend Services only for services referenced by routing rules under infrastructure.resources.<lb>.routing AND that are active: true per architecture.yaml (services[serviceId].active).
  - When any bucket routing exists (rules[].bucket or default_bucket), add per‑region NEGs for the assets-proxy Cloud Run service and synthesize a be-assets-proxy backend.
- Preserve existing ip/cert mode behavior and keep URL Map scaffold (ignore_changes) as-is.

Out of Scope
- Buckets CDKTF module (Sprint 21).
- URL map renderer/importer changes (Sprint 23).
- Migration warnings/CI expansion (Sprint 24).

Deliverables
1) Load Balancer CDKTF Synthesis (routing-driven)
- File: tools/brat/src/providers/cdktf-synth.ts
- Update synthLoadBalancerTf to:
  - Parse infrastructure.resources.<lb>.routing (default_domain, default_bucket, rules[]).
  - Derive unique set of referenced services from rules[].service, filtering to only those with services[serviceId].active === true. Inactive or undefined services are ignored.
  - For each referenced service id s:
    - Create per-region Serverless NEGs (Cloud Run target) tied to service s.
    - Create a google_compute_backend_service named be-<service> with logging enabled and attach regional NEGs.
  - When any bucket rules exist or default_bucket is set:
    - Create per-region Serverless NEGs for the assets-proxy Cloud Run service.
    - Create a google_compute_backend_service named be-assets-proxy and attach those NEGs.
  - Default backend:
    - If any service backends exist, use the first be-<service> as default.
    - Otherwise, default to be-default (existing behavior).
  - Outputs:
    - backendServiceNames: list of synthesized backend service names.
    - negNames: list of regional NEG names created.

2) Unit tests (snapshots)
- File: tools/brat/src/providers/cdktf-synth.loadbalancer.routing.test.ts
- Provide snapshot tests validating that:
  - Only referenced services (from routing) produce NEGs and backend services.
  - be-assets-proxy (and its NEGs) are added whenever bucket routing or default_bucket is present.

Acceptance Criteria
- Dry-run plan shows only necessary backends and NEGs based on routing; be-assets-proxy present when bucket routing exists.
- Services referenced in routing that are not active: true are ignored; no NEGs or backend services are synthesized for them.
- Jest unit tests pass and snapshots are stable, focused on deterministic attributes (names, attachments, logging flags, outputs).

Testing Strategy
- Jest tests colocated with provider: tools/brat/src/providers/cdktf-synth.loadbalancer.routing.test.ts
- Use minimal architecture.yaml fixtures covering three scenarios:
  - Service-only routing
  - Bucket-only routing (default_bucket and/or rules[].bucket)
  - Mixed routing
- Include a case where routing references an inactive service to verify it is excluded from synthesis.
- Normalize or ignore provider-generated, non-deterministic fields in snapshots.

Deployment Approach
- No production applies. Synthesis and dry-run plan only; URL Map importer changes are deferred to Sprint 23.

Dependencies & External Systems
- architecture.yaml provides infrastructure.resources.<lb>.routing and deploymentDefaults.
- Cloud Run services for referenced backends including assets-proxy are assumed to exist (documented expectation).
- Terraform/CDKTF toolchain used for synth/plan.

Definition of Done (DoD)
- synthLoadBalancerTf updated to derive backends from routing rules and conditionally add be-assets-proxy.
- Per‑region NEGs and backend services are created only for referenced services that are active: true (plus assets-proxy when needed).
- Outputs backendServiceNames and negNames are emitted.
- Jest snapshot tests created and passing under npm test.
- This execution plan and the trackable backlog are committed under planning/sprint-22-b91e6c.

Risks & Mitigations
- Risk: Assets proxy service not deployed or lacks IAM for bucket access.
  - Mitigation: Tests/synth proceed; importer/renderer guards handled in Sprint 23; document expectation for assets-proxy.
- Risk: Snapshot flakiness due to provider-generated fields.
  - Mitigation: Focus snapshots on deterministic attributes and normalize dynamic fields.

Traceability
- Implements "Sprint 22 — LB Synth: Routing-Driven Backends and Assets Proxy" from the Sprint 17 planning documents listed above.
- Aligns with architecture.yaml infrastructure.resources for load-balancer entries and routing model.

LLM Prompt Annotations
- llm_prompt: Derived from Issue — "Start a new sprint. Create Sprint Execution Plan and Trackable Backlog for Sprint 22 — LB Synth: Routing-Driven Backends and Assets Proxy Objective."

Trackable Backlog
The authoritative backlog is maintained here:
- planning/sprint-22-b91e6c/backlog.md

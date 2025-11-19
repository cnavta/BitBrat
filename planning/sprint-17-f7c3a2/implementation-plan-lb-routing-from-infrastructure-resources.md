Implementation Plan — LB Routing from infrastructure.resources (plus Buckets)

Role: Lead Implementor
Source of Truth: architecture.yaml
Upstream Design: planning/technical-architecture-lb-routing-from-infrastructure-resources.md
Date: 2025-11-18

Purpose
- Translate the approved technical architecture into concrete, sequenced implementation work.
- Define sprints with deliverables, tests, acceptance criteria, and publication requirements.
- Maintain strict alignment to architecture.yaml and the LLM Sprint Protocol v2.2.

Scope
- Derive Load Balancer (LB) backends and URL Map routing from infrastructure.resources entries of type load-balancer.
- Provision object-store resources (Google Cloud Storage buckets) declared under infrastructure.resources with secure defaults.
- Route bucket traffic through an assets-proxy Cloud Run backend for External Managed ALB.
- Add schema cross-reference validation and a migration path away from lb.services[].

Constraints and Principles
- architecture.yaml is canonical; do not hardcode values.
- Production safety: prefer detect and verify; avoid implicit creation in prod.
- Non-prod: safe automation is allowed with clear preflight checks.
- All artifacts live in-repo under planning and tools; tests with Jest.

Sprint Breakdown (proposed)

Sprint 20 — Schema and Cross-Reference Validation
Objective
- Extend the config schema to model load-balancer routing and object-store resources, and validate cross-references among services, buckets, and routing.

Deliverables
- tools/brat/src/config/schema.ts
  - Add structures for infrastructure.resources with types:
    - object-store with implementation=cloud-storage (buckets)
    - load-balancer with implementation=global-external-application-lb (routing model)
  - Routing validation rules:
    - Exactly one of service or bucket per rule
    - service must reference a top-level service id (warn if inactive)
    - bucket and default_bucket must reference an object-store with implementation=cloud-storage
  - Deprecation behavior:
    - If lb.services[] exists and a routing-driven load-balancer is present, prefer routing and emit a deprecation warning.
- tests: tools/brat/src/config/schema.routing.test.ts
  - Valid: service-only, bucket-only, mixed, default_bucket present
  - Invalid: both service and bucket on one rule, missing references, wrong resource type

Acceptance Criteria
- Parsing valid examples succeeds; invalid examples produce clear error messages.
- Deprecation warning is surfaced when both mechanisms are present.

Definition of Done
- Tests pass; code documented; linked to the design document.

Sprint 21 — Buckets CDKTF Module
Objective
- Provision GCS buckets declared as object-store resources with secure defaults, labels, and outputs.

Deliverables
- tools/brat/src/providers/cdktf-synth.ts
  - Add synthBucketsTf and register CdktfModule "buckets".
  - For each bucket resource:
    - google_storage_bucket with name derived from resource key and env
    - location from resource or deploymentDefaults.region
    - enable versioning and lifecycle rules when configured
    - access_policy private (default) creates no public bindings
    - access_policy public enables uniform bucket-level access and binds allUsers roles/storage.objectViewer
    - labels include env, project, managed-by=brat
  - Outputs: bucketNames[] and bucketUrlsByKey (gs and https urls)
- tests: tools/brat/src/providers/cdktf-synth.buckets.test.ts
  - Snapshot for multiple buckets and policies

Acceptance Criteria
- Dry-run terraform plan shows expected bucket resources and outputs.

Definition of Done
- Module compiles; tests pass; planning docs updated.

Sprint 22 — LB Synth: Routing-Driven Backends and Assets Proxy
Objective
- Generate Serverless NEGs and Backend Services only for services referenced by routing rules; add be-assets-proxy when bucket routing exists.

Deliverables
- tools/brat/src/providers/cdktf-synth.ts
  - Update synthLoadBalancerTf to:
    - Parse infrastructure.resources.<lb>.routing
    - Derive unique set of referenced services; create per-region NEGs targeting Cloud Run and a be-<service> Backend Service with logging enabled
    - When bucket routes or default_bucket exist, add per-region NEGs for the assets-proxy Cloud Run service and a be-assets-proxy backend
    - Default backend: first service backend when any service exists; otherwise be-default
    - Preserve ip and cert mode behavior; keep URL map scaffold with ignore_changes
  - Outputs: backendServiceNames and negNames
- tests: tools/brat/src/providers/cdktf-synth.loadbalancer.routing.test.ts
  - Snapshots ensuring only referenced services produce backends and assets proxy is added when buckets are present

Acceptance Criteria
- Dry-run plan shows only necessary backends and NEGs; be-assets-proxy present when bucket routing exists.

Definition of Done
- Tests pass; code documented.

Sprint 23 — URL Map Renderer and Importer Enhancements
Objective
- Render URL map YAML exclusively from routing; route bucket rules via be-assets-proxy with path rewrite; importer guards include be-assets-proxy.

Deliverables
- tools/brat/src/lb/urlmap/renderer.ts
  - Read infrastructure.resources.<lb>.routing only
  - For service rules, target be-<service>
  - For bucket rules, target be-assets-proxy and add urlRewrite to embed the bucket key per proxy contract
  - Default service picks be-assets-proxy when default_bucket exists; else first be-<service> or be-default
- tools/brat/src/lb/importer/importer.ts
  - Extend backend-existence guard to include be-assets-proxy and any be-<service> referenced
  - Keep policy: non-prod imports automatically; prod detects drift only
- tests
  - Renderer: bucket, service, mixed routing; rewrite correctness
  - Importer: guard includes assets proxy and skip behavior when missing

Acceptance Criteria
- Dev and staging: import runs when backends exist; prod: drift-only with guidance.
- Renderer emits expected YAML; importer parity check succeeds.

Definition of Done
- Tests pass; YAML written to infrastructure/cdktf/lb/url-maps/<env>/url-map.yaml.

Sprint 24 — Migration, CI and Documentation
Objective
- Finalize migration off lb.services[], extend CI validation, and update documentation and runbooks.

Deliverables
- CLI and warnings
  - When both routing-driven LB and lb.services[] are present, emit deprecation warning and prefer routing
  - Optional diagnostic command to list derived backends from routing (if feasible)
- CI
  - cloudbuild.infra-plan.yaml adds a plan step for the buckets module
  - Root validate_deliverable.sh includes buckets plan in dry-run
- Documentation
  - planning/index.md updated with links to the design and this plan
  - Migration notes for moving from lb.services[] to routing-driven configuration
  - Assets proxy expectations (service name and IAM for bucket access)

Acceptance Criteria
- CI plans include buckets and pass; local validation passes in dry-run.
- Deprecation warning visible in logs for legacy configs when both mechanisms are present.

Definition of Done
- Docs updated; CI green on a sample PR; publication requirements ready.

Global Testing Strategy
- Jest unit and snapshot tests for schema, synth, renderer, importer.
- cloudbuild.infra-plan.yaml executes dry-run plans for network, connectors, buckets, and lb, plus URL map import dry-run.
- Root validate_deliverable.sh mirrors CI steps for local checks.

Deployment Approach
- No production applies in these sprints; synth and plan only with guarded importer behavior.
- Applies remain manual outside CI with preflight checks.

Dependencies and External Systems
- GCP project, APIs, and IAM.
- Cloud Run services for referenced backends including assets-proxy.
- Terraform and gcloud CLIs available locally and in CI images.

Epic Definition of Done
- Schema validation complete; buckets module added; LB synth updated; renderer and importer enhanced.
- Tests passing; CI plan jobs green; documentation and migration guidance committed.
- Publication via PR including links to this plan and verification reports.

Traceability
- Implements planning/technical-architecture-lb-routing-from-infrastructure-resources.md.
- Aligns with architecture.yaml infrastructure.resources for load-balancer and object-store entries.

Risks and Mitigations
- Assets proxy not deployed or IAM not configured: Importer guard and documentation; fail safe.
- Breaking legacy lb.services[] users: Deprecation warning and fallback until migration completes.
- Snapshot flakiness: Normalize dynamic fields and focus assertions on stable parts.

Next Actions
- Review and approve this plan.
- Upon approval, proceed with Sprint 20 execution.

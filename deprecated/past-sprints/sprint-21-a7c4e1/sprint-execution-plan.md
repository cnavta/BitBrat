Sprint 21 - Execution Plan — Buckets CDKTF Module

Sprint ID: sprint-21-a7c4e1
Role: Lead Implementor
Source of Truth: architecture.yaml
Upstream References:
- planning/sprint-17-f7c3a2/technical-architecture-lb-routing-from-infrastructure-resources.md
- planning/sprint-17-f7c3a2/implementation-plan-lb-routing-from-infrastructure-resources.md (Sprint 21 section)

Objective & Scope
- Provision Google Cloud Storage buckets declared as object-store resources with implementation=cloud-storage
  under infrastructure.resources.
- Implement a new CDKTF synth module ("buckets") that generates bucket resources with secure defaults and labels,
  and emits outputs for downstream consumers.

Out of Scope
- Load balancer synth changes and assets proxy handling (Sprint 22).
- URL map renderer/importer changes (Sprint 23).
- Migration and CI expansion (Sprint 24).

Deliverables
1) Buckets CDKTF Synthesis
- File: tools/brat/src/providers/cdktf-synth.ts
- Add function synthBucketsTf and register a new CdktfModule named "buckets".
- For each resource with type: object-store and implementation: cloud-storage:
  - Create a google_storage_bucket with:
    - Name: derived from resource key and env (e.g., <key>-<env>)
    - Location: resource.location || deploymentDefaults.region
    - Versioning: enabled when configured on resource
    - Lifecycle rules: applied if provided on resource
    - Access policy:
      - private (default): no public bindings
      - public: enable uniform bucket-level access and bind allUsers: roles/storage.objectViewer
    - Labels: env, project, managed-by=brat
- Outputs:
  - bucketNames[]
  - bucketUrlsByKey (both gs://<bucket> and https://storage.googleapis.com/<bucket>)

2) Unit tests (snapshots)
- File: tools/brat/src/providers/cdktf-synth.buckets.test.ts
- Provide snapshot tests covering multiple buckets with mixed access policies, versioning, and lifecycle settings.

Acceptance Criteria
- Dry-run terraform plan (cdktf synth → terraform plan) shows expected google_storage_bucket resources and outputs.
- Jest unit tests pass and snapshots are stable and reviewable.

Testing Strategy
- Jest tests colocated with provider: tools/brat/src/providers/cdktf-synth.buckets.test.ts
- Focus assertions on stable fields (name, location, IAM mode, labels, and outputs). Normalize dynamic fields if present.
- Include at least two bucket entries: one private with versioning, one public with lifecycle.

Deployment Approach
- No production applies. This sprint focuses on synth and plan only, similar to existing infra plan flows.
- Ensure module compiles; dry-run planning can be executed locally or in CI once wired.

Dependencies & External Systems
- GCP project, Terraform/CDKTF toolchains used for synth/plan.
- architecture.yaml provides infrastructure.resources entries and deploymentDefaults.region.

Definition of Done (DoD)
- synthBucketsTf implemented and registered with the provider module system.
- google_storage_bucket resources generated per configuration; outputs defined.
- Jest snapshot tests created and passing under npm test.
- This execution plan and the trackable backlog are committed under planning/sprint-21-a7c4e1.

Risks & Mitigations
- Risk: Public access misconfiguration.
  - Mitigation: Default to private; require explicit access_policy: public to enable uniform access and allUsers binding.
- Risk: Region mismatch.
  - Mitigation: Use resource.location when set; otherwise default to deploymentDefaults.region from architecture.yaml.
- Risk: Snapshot flakiness.
  - Mitigation: Keep snapshots focused on deterministic attributes; avoid timestamps and provider-generated fields.

Traceability
- Implements "Sprint 21 — Buckets CDKTF Module" from the Sprint 17 planning documents listed above.
- Aligns with architecture.yaml infrastructure.resources for object-store entries.

LLM Prompt Annotations
- llm_prompt: Derived from Issue — "Start a new sprint. Create Sprint Execution Plan and Trackable Backlog for Sprint 21 — Buckets CDKTF Module Objective."

Trackable Backlog
The authoritative backlog is maintained here:
- planning/sprint-21-a7c4e1/backlog.md

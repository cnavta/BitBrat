Sprint 21 — Trackable Backlog

Sprint ID: sprint-21-a7c4e1
Role: Lead Implementor
Source of Truth: architecture.yaml
Related Plan: planning/sprint-21-a7c4e1/sprint-execution-plan.md

Notes
- Status markers: [ ] = not started, [*] = in progress, [x] = done
- Each task includes acceptance criteria and traceability to code/tests.

[x] S21-T1: Provider scaffolding — register CdktfModule "buckets"
- Acceptance Criteria:
  - New synthBucketsTf function is defined and exported
  - Provider registers a module named "buckets" invoking synthBucketsTf
- Traceability:
  - Code: tools/brat/src/providers/cdktf-synth.ts

[x] S21-T2: Input discovery — enumerate object-store/cloud-storage resources
- Acceptance Criteria:
  - synthBucketsTf iterates infrastructure.resources entries of type object-store with implementation=cloud-storage
  - Derives environment and project labels from configuration (deploymentDefaults/env)
- Traceability:
  - Code: tools/brat/src/providers/cdktf-synth.ts
  - Config: architecture.yaml (deploymentDefaults, infrastructure.resources)

[x] S21-T3: Naming and location resolution
- Acceptance Criteria:
  - Bucket name normalized as <resourceKey>-<env>
  - Location resolved as resource.location || deploymentDefaults.region
- Traceability:
  - Code: tools/brat/src/providers/cdktf-synth.ts

[x] S21-T4: Access policy handling (private/public)
- Acceptance Criteria:
  - private (default): no public IAM bindings are emitted
  - public: enables uniform bucket-level access and binds allUsers: roles/storage.objectViewer
- Traceability:
  - Code: tools/brat/src/providers/cdktf-synth.ts
  - Tests: tools/brat/src/providers/cdktf-synth.buckets.test.ts

[x] S21-T5: Versioning and lifecycle support
- Acceptance Criteria:
  - When resource.versioning=true, bucket versioning is enabled
  - When resource.lifecycle is provided, lifecycle rules are rendered into Terraform
- Traceability:
  - Code: tools/brat/src/providers/cdktf-synth.ts
  - Tests: tools/brat/src/providers/cdktf-synth.buckets.test.ts

[x] S21-T6: Labels
- Acceptance Criteria:
  - Labels include env, project, managed-by=brat; merges any resource.labels without overwriting required keys
- Traceability:
  - Code: tools/brat/src/providers/cdktf-synth.ts

[x] S21-T7: Outputs
- Acceptance Criteria:
  - Output bucketNames[] (ordered by resource key)
  - Output bucketUrlsByKey with gs:// and https://storage.googleapis.com URLs
- Traceability:
  - Code: tools/brat/src/providers/cdktf-synth.ts
  - Tests: tools/brat/src/providers/cdktf-synth.buckets.test.ts (snapshot includes outputs)

[x] S21-T8: Tests — snapshot coverage for multiple buckets and policies
- Acceptance Criteria:
  - Snapshot includes at least two buckets: one private with versioning, one public with lifecycle
  - Assertions focus on deterministic attributes (name, location, IAM/public mode, labels, outputs)
- Traceability:
  - Tests: tools/brat/src/providers/cdktf-synth.buckets.test.ts

[x] S21-T9: Documentation & annotations
- Acceptance Criteria:
  - Inline JSDoc for synthBucketsTf documents inputs, behavior, and security defaults
  - Plan/backlog committed under planning/sprint-21-a7c4e1
- Traceability:
  - Docs: planning/sprint-21-a7c4e1/sprint-execution-plan.md, this backlog

[x] S21-T10: Validation wiring
- Acceptance Criteria:
  - Root validate_deliverable.sh continues to pass tests
  - Sprint-level validate_deliverable.sh verifies existence of this sprint’s planning artifacts
- Traceability:
  - Scripts: validate_deliverable.sh (root), planning/sprint-21-a7c4e1/validate_deliverable.sh

Validation Procedure
1) Local: npm ci && npm run build && npm test — ensure new tests pass (post-implementation).
2) Infra dry-run (post-implementation): Run cloudbuild.infra-plan.yaml buckets stage or local cdktf synth/plan to verify resources and outputs.

Traceability
- Mirrors the “Sprint 21” section of planning/sprint-17-f7c3a2/implementation-plan-lb-routing-from-infrastructure-resources.md
- Aligns with planning/sprint-17-f7c3a2/technical-architecture-lb-routing-from-infrastructure-resources.md and architecture.yaml

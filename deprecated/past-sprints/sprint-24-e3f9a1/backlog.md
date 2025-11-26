# Sprint 24 Backlog — Migration, CI and Documentation

Sprint ID: sprint-24-e3f9a1
Role: Lead Implementor
Source: architecture.yaml
Upstream: planning/sprint-17-f7c3a2/technical-architecture-lb-routing-from-infrastructure-resources.md

Legend
- Type: [Story|Task|Chore|Spike]
- Est: story points
- Dep: dependencies by ID

Backlog Items

BI-24-001 — Deprecation warning when both routing and lb.services[] present — Done ✓
- Type: Story
- Est: 3
- Description: Ensure CLI emits deprecation warning and prefers routing when both a routing-driven load-balancer resource and legacy lb.services[] exist.
- Acceptance Criteria:
  - Clear warning logged at startup/config parse.
  - Behavior preference documented: routing wins.
- Evidence:
  - tools/brat/src/config/schema.ts emits warning: "Deprecation: lb.services[] is ignored when a routing-driven load-balancer resource exists".
  - Covered by schema.routing.test.ts.
- Dep: —

BI-24-002 — Diagnostic command design: list derived backends from routing — Done ✓
- Type: Spike
- Est: 2
- Description: Define the interface/spec for an optional CLI diagnostic to enumerate backends implied by routing rules.
- Acceptance Criteria:
  - Spec document drafted with command name, flags, and expected output format.
  - Implementation deferred unless time allows.
- Artifact: planning/sprint-24-e3f9a1/diagnostic-command-spec.md
- Dep: BI-24-001

BI-24-003 — CI: Add buckets plan step to cloudbuild.infra-plan.yaml — Done ✓
- Type: Task
- Est: 3
- Description: Update Cloud Build infra plan to run a dry-run plan for the buckets CDKTF module.
- Acceptance Criteria:
  - New step present and executed in CI (dry-run).
  - Step names and images align with existing CI conventions.
- Evidence: Added step "Plan buckets (dry-run)" to cloudbuild.infra-plan.yaml.
- Dep: —

BI-24-004 — Local validation: include buckets plan in validate_deliverable.sh — Done ✓
- Type: Task
- Est: 2
- Description: Update root validate_deliverable.sh to mirror CI by including the buckets plan in dry-run.
- Acceptance Criteria:
  - Script runs end-to-end locally and surfaces buckets plan output.
- Evidence: validate_deliverable.sh now calls `infra plan buckets` between connectors and lb.
- Dep: BI-24-003

BI-24-005 — Update planning/index.md with links and context — Done ✓
- Type: Chore
- Est: 1
- Description: Add links to the technical architecture, Sprint 24 plan, and migration notes.
- Acceptance Criteria:
  - planning/index.md contains a Sprint 24 section with links.
- Artifact: planning/index.md updated with Sprint 24 section and links.
- Dep: —

BI-24-006 — Migration notes: lb.services[] -> routing-driven config — Done ✓
- Type: Task
- Est: 3
- Description: Author migration guidance detailing steps, examples, and deprecation timeline.
- Acceptance Criteria:
  - Document checked into sprint-24 folder and linked from planning/index.md.
- Artifact: planning/sprint-24-e3f9a1/migration-notes.md
- Dep: BI-24-001, BI-24-005

BI-24-007 — Assets proxy expectations doc — Done ✓
- Type: Task
- Est: 2
- Description: Document assets-proxy naming convention and IAM requirements for bucket access.
- Acceptance Criteria:
  - Document checked into sprint-24 folder with actionable IAM guidance.
- Artifact: planning/sprint-24-e3f9a1/assets-proxy-expectations.md
- Dep: BI-24-006

BI-24-008 — Validation & PR publication — Done ✓
- Type: Task
- Est: 2
- Description: Run validation locally/CI; open PR with links to sprint-execution-plan.md and backlog.md per protocol.
- Acceptance Criteria:
  - CI green; PR includes validation notes and documentation links.
- Dep: BI-24-003, BI-24-004, BI-24-005 .. BI-24-007

BI-24-009 — Remediate Cloud Build 429 quota during service deploys — Done ✓
- Type: Bugfix
- Est: 3
- Description: Reduce Cloud Build API Get request rate by switching to async submission with throttled polling and exponential backoff on 429.
- Acceptance Criteria:
  - tools/brat uses `gcloud builds submit --async` and polls `gcloud builds describe` no more than every 5s by default.
  - Backoff logic handles RESOURCE_EXHAUSTED (429) gracefully without failing the entire deploy.
  - Unit test covers build ID extraction from gcloud output.
- Evidence:
  - Code: tools/brat/src/providers/gcp/cloudbuild.ts
  - Test: tools/brat/src/providers/gcp/cloudbuild.spec.ts
  - Behavior: two concurrent deploys now keep Get requests < 60/min default quota.

Notes
- Keep alignment with architecture.yaml and the LLM Sprint Protocol v2.2.
- Treat CI steps as dry-run only; no production applies.

# Sprint 7 — CDKTF Scaffolding and CI Wiring (Plan-only)

Sprint ID: sprint-7-a13b2f
Role: Lead Implementor
Source of Truth: architecture.yaml
Upstream References:
- planning/sprint-6-d7e4b0/network-lb-implementation-plan.md (see lines 29–49 for Sprint 7 scope and AC)
- planning/sprint-6-d7e4b0/network-and-lb-technical-architecture.md (see lines 23–39 for repo structure)

## 1. Objective
Establish a detailed, approved plan to introduce CDKTF project scaffolding and CI wiring for the Network and Load Balancer stacks — without creating any cloud resources. This sprint is plan-only and produces no IaC code or applied changes.

## 2. Scope
- Define repository layout for CDKTF stacks (network, lb) aligned to the technical architecture.
- Define brat CLI wiring at a high level for `brat infra plan|apply network|lb`, delegating to a Terraform adapter. For this sprint, the behavior is documentation-only and synth/plan-only in CI; no apply.
- Define CI (Cloud Build) additions to run dry-run planning on PRs: `npm ci && npm run build && brat infra plan network && brat infra plan lb`.
- Define validation and testing approach (zod-validated configs, synth hooks) to be implemented in a subsequent sprint.

## 3. Non-Goals
- Creating any Terraform/CDKTF resources.
- Committing actual CDKTF TypeScript sources or URL map YAML files.
- Enabling remote state, credentials, or GCP API changes.

## 4. Deliverables (Plan Artifacts Only)
- This implementation plan (approved) documenting:
  - Repo skeleton to be created next sprint
  - CLI command interfaces and responsibilities
  - CI job wiring (dry-run only)
  - Acceptance criteria and testing strategy
- Sprint planning artifacts: sprint-manifest.yaml, request-log.md, validate_deliverable.sh, publication.yaml (stub)
- Update to planning/index.md with Sprint 7 section

## 5. Proposed Repository Structure (to be created in Sprint 8+)
As defined in the technical architecture:

infrastructure/
  cdktf/
    network/
      main.ts           # CDKTF app for VPC, subnets, router, NAT, firewall (future)
      config.ts         # Inputs derived from architecture.yaml/env overlays (zod schema)
      outputs.ts        # Export subnet selfLinks, router names, etc.
    lb/
      main.ts           # CDKTF app for LB scaffolding (certs, proxy, forwarding, NEGs)
      url-maps/
        dev/url-map.yaml
        staging/url-map.yaml
        prod/url-map.yaml
      config.ts         # Inputs from architecture.yaml (domains, routes)
      outputs.ts        # IP addresses, URL map name, cert IDs

Notes:
- No files under infrastructure/ are created in this sprint. This is a planning baseline only.

## 6. CLI Wiring (brat) — Plan
High-level commands to be implemented later:
- brat infra plan network [--env=<env>] [--dry-run]
- brat infra apply network [--env=<env>] [--approve]
- brat infra plan lb [--env=<env>] [--dry-run]
- brat infra apply lb [--env=<env>] [--approve]

Responsibilities (future):
- Resolve inputs from architecture.yaml and env overlays
- Synthesize CDKTF → Terraform JSON
- Run `terraform init/plan` (plan mode in CI). Apply guarded behind explicit approvals and out of scope this sprint.
- For LB, skip URL map import in plan; import guarded in a later sprint

Policy constraints to encode later:
- No runtime images bundle brat
- Default to strict mode in CI; no `--allow-no-vpc`

## 7. CI Additions (Plan)
Update Cloud Build configuration to add a dry-run check on PRs:
- Steps:
  1) npm ci
  2) npm run build
  3) tools/brat invocation: `brat infra plan network --dry-run` and `brat infra plan lb --dry-run`
- Behavior:
  - Must not create resources; synth/plan-only
  - Fails the build if commands exit non-zero
- Publication: Link CI changes in PR for the implementation sprint (not this plan-only sprint)

## 8. Configuration & Validation Strategy (Plan)
- Config loaders use zod schemas for both stacks:
  - network/config.ts: projectId, environment, regions, cidrBlocks, subnets?, enableFlowLogs
  - lb/config.ts: projectId, environment, domains map, services list (name, regions), urlMapPath, ipMode (create|use-existing), ipName, certMode (create|use-existing), certRef
- Unit tests (Jest) to validate schema parsing and minimal synth hooks
- Root validation: ensure CLI can be invoked in dry-run in CI (future)

## 9. Acceptance Criteria (from Sprint 6 plan)
- `brat infra plan network|lb` runs successfully in dry-run on CI; no resource apply
- zod-validated inputs for network/lb configs compile with placeholders
- Documentation: READMEs for each stack and update to planning index
- Unit tests for config loader schema (zod) and synth hooks (planned for next sprint); this sprint records the strategy
- `validate_deliverable.sh` passes and CI path is documented

## 10. Testing Strategy (Plan)
- Define Jest tests to be implemented next sprint:
  - Schema validation with sample overlays
  - Synthesis snapshot tests for Terraform JSON structure
- CI will run tests in future sprints; for now, validate documentation presence via sprint-level script

## 11. Deployment Approach (Future)
- Use Cloud Build as the orchestrator
- Deploy to Cloud Run for CLI container execution if needed for infra jobs (optional)
- Store Terraform state in GCS per environment (to be configured in Sprint 8)

## 12. Dependencies
- None for plan-only; no GCP changes required

## 13. Risks & Mitigations
- Risk: Ambiguity in architecture.yaml mappings → Mitigation: Derive configs directly and avoid duplication
- Risk: Provider gaps for URL maps → Mitigation: YAML-first import in later sprint with lifecycle ignore_changes
- Risk: CI accidentally applies → Mitigation: enforce plan-only commands in CI, no apply steps configured

## 14. Definition of Done (DoD)
- This document approved by stakeholders
- Planning artifacts created and indexed in planning/index.md
- Validation script passes locally
- No code or infra resources created

## 15. Traceability
- Derived from: planning/sprint-6-d7e4b0/network-and-lb-technical-architecture.md and planning/sprint-6-d7e4b0/network-lb-implementation-plan.md
- Aligns with LLM Sprint Protocol v2.2 (Plan → Approve → Implement → Validate → Verify → Publish)

## 16. Next Steps
- Seek approval of this plan
- In Sprint 8, create CDKTF scaffolding and minimal zod schemas + unit tests
- Wire CI steps for synth/plan (no apply) and ensure dry-run passes in PRs

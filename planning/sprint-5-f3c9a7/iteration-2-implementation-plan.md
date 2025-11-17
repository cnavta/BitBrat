# Iteration 2 Implementation Plan — Phase 3 (CDKTF Expansion)

Sprint: sprint-5-f3c9a7
Owner: Lead Implementor
Status: Proposed (awaiting approval)
Source of Truth: architecture.yaml
Related Docs:
- planning/sprint-4-b5a2d1/architecture-iac-cli.md (§5 Phases, lines 171–186; §10 Packaging)
- planning/sprint-5-f3c9a7/implementation-plan.md (Phase 3 scope)
- planning/sprint-5-f3c9a7/verification-report.md

## Objective & Scope
Expand the Phase 3 CDKTF introduction from a minimal synth to functional scaffolding driven by architecture.yaml, while remaining non-destructive (plan-only by default):
- Network: generate a real VPC and a minimal subnet topology from architecture.yaml defaults.
- Load Balancer: scaffold external HTTPS Application LB resources with placeholder backends mapped from architecture.yaml routing, but disabled by default.
- Keep applies gated; CI and validate scripts run only dry-run plans.

## Deliverables
1. CDKTF Synth Enhancements (tools/brat/src/providers/cdktf-synth.ts)
   - network module: synthesize Terraform with:
     - google provider block (project/region variables)
     - google_compute_network
     - one google_compute_subnetwork for the default region (CIDR placeholder 10.0.0.0/24)
     - variables.tf for project/region where useful
   - load-balancer module: synthesize Terraform with:
     - provider blocks
     - placeholder resources: url map, backend service stubs, comments mapping architecture.yaml.infrastructure.main-load-balancer.routing rules
   - idempotent file writes; tolerant of missing fields.

2. CLI Integration (no new flags; reuse --module)
   - Ensure `brat infra plan --module network|load-balancer` runs init/validate/plan successfully on synthesized outputs.
   - Maintain dry-run semantics; do not auto-apply.

3. Tests (Jest)
   - tools/brat/src/providers/cdktf-synth.spec.ts:
     - Assert generated main.tf contains expected resource stubs (google_compute_network for network; comments and stubs for LB).
     - Golden-like string checks for resource names derived from architecture.yaml (e.g., VPC name from defaults.network if present).

4. Planning & Docs
   - Update request-log.md with this iteration plan.
   - Keep packaging boundary explicit (no brat in service images).

## Acceptance Criteria
- `node dist/tools/brat/src/cli/index.js infra plan --module network --dry-run` completes `terraform init|validate|plan` without errors on a clean repo.
- `node dist/tools/brat/src/cli/index.js infra plan --module load-balancer --dry-run` completes plan with placeholder/stubbed resources.
- Unit tests cover synth mapping to include at least one real resource for network and placeholder structure for LB.
- No destructive operations are executed by default; apply requires explicit command and will be avoided this iteration.

## Testing Strategy
- Unit tests:
  - Verify synth output contains: required_version, provider blocks, network/subnetwork resource stubs.
  - Verify LB output includes URL map and backend placeholders referencing architecture.yaml routes (as comments or names).
- Manual/dry-run integration:
  - Run `brat doctor` to verify terraform present.
  - Run infra plan with `--module` for both modules on developer workstation.
- CI:
  - Keep validate_deliverable.sh unchanged (build + tests). A separate manual step can run dry-run plans.

## Deployment Approach
- No deployment (apply) in this iteration.
- Future iterations will parameterize CIDRs and enable controlled apply behind flags.

## Dependencies & External Systems
- Terraform >= 1.5 installed locally for manual validation.
- GCP auth (gcloud application-default login) if needed by providers during validation (note: plan should not need API calls for stubs).
- architecture.yaml for defaults like region and potential future network naming.

## Definition of Done (DoD)
- Synth produces Terraform that passes `terraform init`, `validate`, and `plan` without external modules.
- Unit tests pass in CI (jest).
- Planning artifacts updated and traceable to sprint and prompt.
- No service images include brat artifacts; enforced by design (no changes to service Dockerfiles).

## Risks & Mitigations
- Terraform provider requiring credentials during plan: keep resources minimal and avoid data sources; plan locally where credentials exist.
- Naming collisions: generate deterministic names (e.g., `bitbrat-vpc` or use architecture.defaults.services.network when available).
- Future refactor to real CDKTF code: this iteration keeps HCL synth via TypeScript for speed; later replace with actual CDKTF constructs if warranted.

## Work Breakdown
1. Enhance synth for network resources (scaffold only)
2. Enhance synth for LB placeholders
3. Update/extend unit tests
4. Manual dry-run validation instructions
5. Documentation and request-log update

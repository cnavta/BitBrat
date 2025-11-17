# Sprint 8 — Implement CDKTF Scaffolding + CI Dry‑Run

Sprint ID: sprint-8-ef72c3
Role: Lead Implementor
Source of Truth: architecture.yaml
Upstream References:
- planning/sprint-6-d7e4b0/network-lb-implementation-plan.md (multi‑sprint breakdown)
- planning/sprint-6-d7e4b0/network-and-lb-technical-architecture.md (repo structure, inputs/outputs)
- planning/sprint-7-a13b2f/implementation-plan.md (plan-only baseline)
- planning/sprint-7-a13b2f/verification-report.md (deferred items)

## 1. Objective
Implement minimal-but-functional CDKTF scaffolding for Network and HTTPS Load Balancer stacks, wire brat CLI plan/apply commands, and add Cloud Build PR checks to run synth/plan in dry‑run. No real resources are created by default; apply is gated behind explicit approval and disabled in CI.

## 2. Current State Assessment
- Sprint 7 planning completed; Sprint 7 will be closed manually outside this sprint.
- Implementation work for CDKTF scaffolding and CI dry‑run begins in Sprint 8.
- No infrastructure resources will be created by default; apply remains gated.

## 3. Scope
- Create initial CDKTF module scaffolds:
  - infrastructure/cdktf/network/{main.ts, config.ts, outputs.ts, README.md}
  - infrastructure/cdktf/lb/{main.ts, config.ts, outputs.ts, README.md}
  - infrastructure/cdktf/lb/url-maps/{dev,staging,prod}/url-map.yaml (placeholders for YAML‑first import)
- brat CLI wiring:
  - `brat infra plan network|lb` → synth minimal Terraform and run `terraform plan`
  - `brat infra apply network|lb` → synth and run `terraform apply` (guarded; not used in CI)
- CI wiring (Cloud Build):
  - On PR, run: `npm ci && npm run build && brat infra plan network --dry-run && brat infra plan lb --dry-run`
- Unit tests and docs:
  - Jest unit tests for synth hooks and config schema placeholders
  - READMEs for network and lb modules describing inputs/outputs and usage via brat

## 4. Out of Scope
- Provisioning any actual GCP resources beyond a zero‑resource Terraform plan
- Remote state backends, credentials changes, or API enablement
- URL map import workflow execution (design placeholders only this sprint)

## 5. Deliverables
- CDKTF scaffold files under infrastructure/cdktf/... (no resources yet, synth OK)
- brat CLI enhancements enabling plan/apply for `network` and `lb` targets
- Cloud Build PR job additions for dry‑run synth/plan
- Documentation: module READMEs

## 6. Work Plan (Tasks)
1) CDKTF scaffolding
   - Create directories and placeholder files per structure above
   - Implement minimal CDKTF app shells (TypeScript) that synthesize to Terraform JSON with zero resources
   - Pin Terraform and provider versions to avoid CI drift
2) CLI wiring (tools/brat)
   - Add subcommands:
     - `brat infra plan network` → synthModule('network') → terraformPlanGeneric
     - `brat infra plan lb` → synthModule('load-balancer') → terraformPlanGeneric
     - `brat infra apply network|lb` → terraformApplyGeneric (guarded; refuse when `--ci` or `--dry-run`)
3) CI wiring
   - Update cloudbuild.brat.yaml to run dry‑run synth/plan for network and lb on PRs
   - Ensure steps run after build/test and fail the build on non‑zero exit
4) Tests
   - Unit test: synth produces expected JSON structure; mock terraform executable
   - Unit test: config schema placeholders (e.g., zod) validate defaults
5) Documentation
   - README.md in each module covering inputs, outputs, how to run via brat
6) Publication
   - Open branch `feature/sprint-8-ef72c3`, commit changes, and open PR; update planning/sprint-8-ef72c3/publication.yaml with live PR URL/status

## 7. Acceptance Criteria
- `brat infra plan network --dry-run` and `brat infra plan lb --dry-run` succeed locally and in CI without creating resources
- CI fails if any synth/plan step exits non‑zero
- Unit tests pass in CI
- Module READMEs present

## 8. Testing Strategy
- Jest unit tests alongside new scaffolding and CLI wiring (mock terraform and filesystem)
- CI executes `npm test` and the dry‑run synth/plan commands

## 9. Deployment Approach
- Cloud Build orchestrates CI; PRs run dry‑run only
- Apply is manual, outside CI, and explicitly gated

## 10. Dependencies
- Node.js 20+/TypeScript toolchain
- Local Terraform CLI available in CI image/environment (pinned)

## 11. Risks & Mitigations
- Terraform version mismatch → Pin minimal required version and validate in CI
- Accidental apply in CI → No apply steps in CI; guard `apply` subcommand behind explicit flag checks
- CDKTF structure drift vs architecture.yaml → Cross‑check inputs/outputs against architecture.yaml on review

## 12. Definition of Done (DoD)
- CDKTF scaffolds committed; brat CLI wiring implemented; CI dry‑run steps added
- Unit tests pass in CI
- validate_deliverable.sh for this sprint passes locally
- publication.yaml updated with PR info for this sprint

## 13. Traceability
- Aligns with Sprint 6 technical architecture and Sprint 7 plan‑only deliverables; Sprint 7 will be closed manually outside this sprint. This plan focuses solely on Sprint 8 implementation.

# Implementation Plan — Phase 3 (CDKTF Introduction and Backlog Carry-Forward)

Sprint: sprint-5-f3c9a7
Owner: Lead Implementor
Status: Draft (awaiting approval)
Source of Truth: architecture.yaml
Related Docs:
- planning/sprint-4-b5a2d1/architecture-iac-cli.md (Phase overview; see §5 Phases, lines 171–186)
- planning/sprint-4-b5a2d1/verification-report.md (Backlog, lines 24–29)

## Objective & Scope
Introduce CDKTF for infrastructure components where programmatic composition improves maintainability and scalability, starting with networking:
- VPC, subnets per region, Cloud Router/NAT as applicable
- HTTP(S) Load Balancer scaffolding targeting Cloud Run backends (as appropriate per architecture.yaml)
- Synthesize to Terraform and execute via the existing Terraform adapter in the brat CLI
Carry forward unimplemented Phase 2 deliverables where feasible without jeopardizing Phase 3 focus:
- SDK migration for GCP (Secret Manager, Cloud Build, Cloud Run) — initial adapters and incremental replacement with gcloud fallbacks
- Trigger management commands (create|update|delete) via SDKs or gcloud fallback

## Deliverables
- CDKTF network module scaffolding under infrastructure/cdktf/network
  - Programmatic topology from architecture.yaml (regions, subnets, IP ranges)
  - Optional NAT/Cloud Router per region as required
- CDKTF load balancer scaffolding under infrastructure/cdktf/load-balancer
  - HTTP(S) external LB front-end and URL map placeholders
  - Backend service mapping for Cloud Run services (names and regions from architecture.yaml), disabled by default until verified
- Terraform Adapter integration
  - CDKTF synth output directory wired into brat infra plan|apply
- GCP SDK adapters (Phase 2 backlog)
  - Secret Manager: resolve ENABLED numeric versions
  - Cloud Build: trigger management primitives
  - Cloud Run: service describe for deploy validations
- CLI commands (Phase 2 backlog)
  - brat trigger create|update|delete (feature-complete when SDK adapter stabilized; otherwise gcloud fallback)
- Documentation
  - CDKTF module design notes and mapping from architecture.yaml
  - Updates to planning artifacts
- Tests
  - Unit: config → CDKTF input mapping, LB backend mapping rules, adapter argument construction
  - Integration (dry-run): synth + terraform plan for a fixture environment

## Acceptance Criteria
- architecture.yaml drives all CDKTF inputs; zod validation ensures required fields before synth
- `brat infra plan --module network` produces a successful plan (dry-run) using synthesized Terraform
- `brat infra plan --module load-balancer` produces a successful plan (dry-run) using synthesized Terraform (may be partial/backends disabled)
- No brat sources are bundled inside any application images (packaging boundary enforced)
- SDK adapters exist and are used where practical; where not, gcloud fallback is implemented with strict parsing
- validate_deliverable.sh passes end-to-end (npm ci, build, test) and exercises at least the synth+plan dry-run

## Testing Strategy
- Unit tests with Jest for:
  - Schema validation and mapping from architecture.yaml → CDKTF constructs
  - Construction of Cloud Build substitutions and trigger payloads (for backlog tasks)
  - Secret version resolution behavior (mocked SDK)
- Integration (dry-run):
  - CDKTF synthesis runs and outputs Terraform to a temp directory
  - Terraform adapter runs init/validate/plan with no changes applied
  - Golden file comparisons for key generated resources (resource names, labels, regions)

## Deployment Approach
- Continue to orchestrate via brat CLI: `infra plan|apply` commands
- CDKTF synthesizes to Terraform JSON/HCL which is then consumed by the existing Terraform adapter
- Default to dry-run during this sprint; applies only after explicit approval

## Dependencies & External Systems
- Node 24, Terraform, CDKTF toolchain, gcloud SDK
- GCP IAM permissions for reading project metadata, Secret Manager access (read-only), Cloud Build, Cloud Run (read/describe)
- architecture.yaml and env overlays under env/**
- Policy: no automatic secret creation/import

## Definition of Done (DoD)
- Plan approved and merged under planning/sprint-5-f3c9a7
- Unit tests for new modules are added and passing in CI
- validate_deliverable.sh completes successfully and includes a dry-run of infra planning using brat
- Documentation updated (design notes, mapping specs, request-log entries)
- Clear traceability to prompt IDs and sprint IDs in code comments or docs

## Work Breakdown (Tasks)
1. Planning and Schemas
   - Define zod schemas for network and LB inputs (regions, subnets, LB backends)
   - Map architecture.yaml to schema types
2. CDKTF Network Module
   - Scaffold stacks: VPC, subnets, secondary ranges (if needed), Cloud Router/NAT
   - Synthesize to infrastructure/cdktf/out/network
   - Terraform adapter integration
3. CDKTF Load Balancer Module
   - Scaffold: global forwarding rule, target HTTPS proxy, URL map, backend services
   - Backend mapping to Cloud Run services (names/regions), initially disabled or placeholder
   - Synthesize to infrastructure/cdktf/out/load-balancer
4. CLI Integration
   - Extend brat infra plan|apply to accept `--module network|load-balancer` and route to synthesized output
   - Ensure `--dry-run` passes through to plan-only
5. Backlog from Phase 2
   - Implement Secret Manager adapter (resolve numeric versions)
   - Implement trigger commands using SDK or gcloud fallback
   - Add Cloud Run describe adapter used by deploy validations
6. Tests
   - Unit tests for schemas and mapping
   - Integration dry-run tests for synth+plan
7. Documentation & Validation
   - Update design docs and examples under planning
   - Ensure packaging boundary is explicitly tested/verified

## Timeline & Milestones
- Week 1: Schemas + Network CDKTF scaffold + unit tests
- Week 2: Load Balancer scaffold + CLI integration for infra plan
- Week 3: Backlog Phase 2 items (SDK adapters, triggers) + integration dry-run tests
- Week 4: Hardening, docs, validation, PR prep

## Risks & Mitigations
- SDK parity gaps: maintain gcloud fallback and robust error parsing
- LB complexity with Cloud Run backends: treat as scaffolding first; enable incrementally
- Infra drift during migration: run plans in parallel with existing Terraform; block apply until validated

## Out of Scope (This Sprint)
- Full decommissioning of deploy-cloud.sh (Phase 5)
- Production LB cutover; only scaffolding and plan/dry-run

## Traceability
- Sprint Protocol S7: Coding begins only after plan approval — acknowledged
- Attached docs reference:
  - Phase plan lines 171–186 (CDKTF intro) in architecture-iac-cli.md
  - Backlog lines 24–29 in verification-report.md

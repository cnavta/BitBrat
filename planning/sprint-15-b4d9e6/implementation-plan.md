# Sprint 15 — Network Overlay Parity: Regions, Subnets, Flow Logs, Remote State

Sprint ID: sprint-15-b4d9e6
Role: Lead Implementor
Source of Truth: architecture.yaml
Related Designs/Plans:
- planning/sprint-13-ace12f/technical-architecture.md (Sections 2.2, 3, 5.1; 5.85–5.88 for synth changes)
- planning/sprint-13-ace12f/project-implementation-plan.md (Lines 44–64 define this sprint)

## Objective
Implement overlay-driven regions and subnets, optional flow logs, and overlay-driven remote state in synthNetworkTf. Remove all hardcoded regions/CIDRs and make network synthesis entirely controlled by architecture.yaml overlays.

## Scope
- Extend Zod schema in tools/brat/src/config/schema.ts for network overlays:
  - network.regions: string[]
  - network.subnets: map<region, { name?: string, cidr: string }>
  - network.enableFlowLogs: boolean
  - network.remoteState?: { bucket: string, prefix: string }
- Update tools/brat/src/providers/cdktf-synth.ts (synthNetworkTf):
  - Iterate regions and create per-region subnets with Private Google Access
  - Emit subnet flow logs when enableFlowLogs=true (GCP defaults: aggregation_interval=INTERVAL_5_MIN, flow_sampling=0.5, metadata=INCLUDE_ALL)
  - Configure remote backend when remoteState is provided; off by default
- Add unit tests:
  - Schema validation tests (valid/invalid overlays)
  - Synth snapshots for multi-region inputs
- Drive inputs exclusively from architecture.yaml and env overlays

## Deliverables
1) tools/brat/src/config/schema.ts — network schema extended for regions, subnets, flow logs, remote state.
2) tools/brat/src/providers/cdktf-synth.ts — synthNetworkTf honors overlays; no hardcoded CIDRs/regions; remote backend optional.
3) tests — Jest unit tests alongside code under tools/brat/src/**
   - config/schema.network.spec.ts
   - providers/cdktf-synth.network.spec.ts (snapshot-based)
4) Planning artifacts under planning/sprint-15-b4d9e6 per Sprint Protocol v2.2.

## Acceptance Criteria
- No hardcoded CIDRs or regions remain in synthNetworkTf; values sourced from architecture.yaml overlays.
- terraform plan completes successfully in dry-run for a sandbox project using provided overlays.
- Subnets, routers/NATs (if present) are synthesized per overlays.
- Jest tests pass locally and in CI.

## Testing Strategy
- Unit Tests (Jest):
  - Schema tests validating required/optional properties and error messages.
  - Synth tests: generate Terraform JSON and snapshot assert for multi-region overlays with/without flow logs and remote state.
- CI Validation:
  - Use cloudbuild.infra-plan.yaml (from Sprint 14) to run dry-run terraform plan for network on PRs.

## Deployment Approach
- Non-destructive: plan-only in CI.
- Local development mirrors CI using npm run brat commands via root validate_deliverable.sh.

## Dependencies
- Sprint 14 CI infra-plan job in place (cloudbuild.infra-plan.yaml with plan steps).
- architecture.yaml contains or will contain overlay examples for network inputs.

## Risks & Mitigations
- Risk: Missing or inconsistent overlays across envs → Mitigation: strict Zod validation with descriptive errors and tests.
- Risk: Remote state misconfiguration → Mitigation: Backend wiring is optional and guarded; clear errors when provided but invalid.
- Risk: Terraform provider/version drift → Mitigation: Reuse existing versions; avoid provider changes this sprint.

## Definition of Done (DoD)
- Schema and synth changes implemented with green Jest tests.
- CI dry-run terraform plan demonstrates overlay-driven network outputs with no hardcoded values.
- Planning artifacts updated and linked in planning/index.md.

## Trackable Backlog
- [x] T1: Extend Zod schema for network.regions (string[]) and network.subnets (map of region → { name?, cidr }). Owner: Lead Implementor
- [x] T2: Add network.enableFlowLogs (boolean, default false) and network.remoteState? ({ bucket, prefix }) to schema with validation. Owner: Lead Implementor
- [x] T3: Update synthNetworkTf to iterate regions and create per-region subnets with Private Google Access. Owner: Lead Implementor
- [x] T4: Implement flow logs emission on subnets when enableFlowLogs=true with sensible GCP defaults. Owner: Lead Implementor
- [x] T5: Add optional remote backend configuration driven by overlays (disabled when remoteState absent). Owner: Lead Implementor
- [x] T6: Write Jest tests for schema (valid/invalid overlays) under tools/brat/src/config/schema.network.spec.ts. Owner: Quality Lead
- [x] T7: Write Jest tests for synthNetworkTf with multi-region overlays, with and without flow logs and remote state. Owner: Quality Lead
- [ ] T8: Wire CI dry-run terraform plan for network using cloudbuild.infra-plan.yaml; document expected outputs. Owner: Cloud Architect
- [ ] T9: Update docs/comments in architecture.yaml to illustrate overlay fields (non-normative, examples only). Owner: Lead Architect
- [ ] T10: Prepare PR: branch feature/sprint-15-b4d9e6; include planning artifacts and implementation; ensure CI green. Owner: Lead Implementor

## Validation Procedure
1. Local: ./validate_deliverable.sh (root) or planning/sprint-15-b4d9e6/validate_deliverable.sh after implementation approval.
2. CI: Open a PR from feature/sprint-15-b4d9e6 and confirm infra-plan job logs show successful dry-run for network with overlay-driven subnets/regions.

## Traceability
- Prompt: req-2025-11-15-1959
- Implements “Sprint 15 — Network Overlay Parity: Regions, Subnets, Flow Logs, Remote State” from planning/sprint-13-ace12f/project-implementation-plan.md (Lines 44–64) and aligns to technical-architecture.md Sections 2 and 5.

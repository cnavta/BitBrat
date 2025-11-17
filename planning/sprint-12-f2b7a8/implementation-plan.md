# Implementation Plan — Sprint 12 (sprint-12-f2b7a8)

Sprint: sprint-12-f2b7a8
Owner: Lead Implementor
Date: 2025-11-15
Source of Truth: architecture.yaml
Related: planning/sprint-6-d7e4b0/network-lb-implementation-plan.md (§Sprint 12), planning/sprint-6-d7e4b0/network-and-lb-technical-architecture.md (§5)

## Objective & Scope
Production cutover and hardening for the HTTPS Load Balancer stack using use-existing IP and certificate, guarded URL map import, DNS readiness checks, observability, and optional Cloud Armor. Publication via PR per Sprint Protocol v2.2.

## Deliverables
1. Prod apply of LB stack with use-existing IP and cert
2. Guarded URL map import using YAML-first strategy (describe/diff/import; lifecycle ignore_changes remains on stub)
3. DNS readiness validation, rollback plan documented
4. Observability verification (backend logging) and optional Cloud Armor attach
5. Publication: PR with execution + verification artifacts, updated planning index

## Acceptance Criteria
- No creation of prod IP/cert resources; data-sourced and validated ACTIVE
- Guarded importer produces zero unexpected drift post-import and re-describe matches desired YAML
- DNS A records resolve to expected global IP; HTTPS serves ACTIVE cert across SANs
- Backend logging visible for synthetic checks; Cloud Armor attached if in scope
- `planning/sprint-12-f2b7a8/validate_deliverable.sh` passes and PR prepared via publication.yaml

## Testing Strategy
- Unit/CLI-level: deterministic renderer output; importer --dry-run verifies describe and diff
- Integration: smoke tests on critical routes post-apply; check Cloud Logging entries
- CI: cloudbuild.infra-plan.yaml runs prod plan and importer --dry-run; root validate_deliverable.sh passes

## Deployment Approach
- Preflight stage: resolve prod inputs (IP name, cert ref) from architecture.yaml/env overlays; verify cert status ACTIVE
- Plan stage: run brat infra plan lb --env=prod; ensure use-existing mode engaged
- Change window: run brat infra apply lb --env=prod followed by guarded importer if drift
- Validation: DNS/cert checks; log verification; optional Cloud Armor attach
- Rollback: re-import last known-good YAML; restore previous proxy/cert mapping if needed

## Dependencies
- Completion of Sprints 8–11 (network, NEGs/backends, connectors, URL map renderer/importer)
- GCP APIs: compute.googleapis.com, certificatemanager.googleapis.com or managed SSL
- Prod overlays present for domains, IP, cert references

## Definition of Done (DoD)
- All acceptance criteria satisfied
- Planning artifacts updated and validated by sprint-level validator
- PR opened with links to execution plan, verification report, retro, and manifest

## Risks & Mitigations
- Cert not ACTIVE: preflight abort, DNS ownership verification
- Drift loops on url-map: normalized YAML, ignore_changes, manual pause
- DNS propagation: reduced TTL, staged rollout, rapid rollback
- Cloud Armor breakage: start with logging-only, test non-disruptively

## Traceability
- Aligned with Sprint 12 deliverables in planning/sprint-6-d7e4b0/network-lb-implementation-plan.md
- URL Map strategy per planning/sprint-6-d7e4b0/network-and-lb-technical-architecture.md §5.3

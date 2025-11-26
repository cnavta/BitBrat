# Sprint Execution Plan — Sprint 12 (sprint-12-f2b7a8)

Date: 2025-11-15
Owner: Lead Implementor
Source of Truth: architecture.yaml
Related Design Inputs:
- planning/sprint-6-d7e4b0/network-and-lb-technical-architecture.md
- planning/sprint-6-d7e4b0/network-lb-implementation-plan.md (Sprint 12 section)
- planning/sprint-11-c7a9d3/execution-plan.md and verification-report.md

## 1. Objective & Scope
Production Cutover and Hardening of the Global HTTPS Load Balancer and ingress path, using use-existing production IP and TLS certificate, with a guarded URL Map import (YAML-first), DNS readiness validation, observability checks, and optional Cloud Armor enablement. Ensure all operations conform to Sprint Protocol v2.2 and are traceable to architecture.yaml.

Out of scope: Creating new non‑prod infrastructure beyond what is required for validation; major refactors to brat CLI structure; changes to deprecated content.

## 2. Deliverables
- Prod Apply of LB Stack
  - use-existing Global Static IP (name from env/prod overlay or architecture.yaml)
  - use-existing TLS certificate (ACTIVE) verification and attachment via data sources
  - Target HTTPS Proxy + Forwarding Rule (HTTPS only) wired to URL Map
- Guarded URL Map Import (YAML-first)
  - Pre-import describe/diff
  - Import only on drift, with explicit prod gating and --dry-run support
  - Lifecycle ignore_changes already present on Terraform URL map stub
- DNS Readiness & Cutover Plan
  - Confirm Cloud DNS A records point to the existing global IP
  - Validate cert status ACTIVE prior to cutover
  - Document granular rollback steps
- Observability & Optional Protection
  - Logging enabled on backend services; confirm log entries in Cloud Logging
  - Optional: Attach Cloud Armor policy if defined in architecture.yaml/env overlay
- Publication & Compliance
  - PR with this plan and verification artifacts
  - Update planning/index.md and publication.yaml
  - Sprint validation script updated for Sprint 12

## 3. Dependencies & Preconditions
- Sprints 8–11 completed and validated (network, serverless NEGs/backends, connectors, URL map generator + importer)
- Architecture overlays for prod (domains, IP/cert names) available
- Required GCP APIs enabled (Compute, Certificate Manager or Managed SSL as applicable)

## 4. Work Breakdown Structure (WBS)
1) Confirm Inputs and Prod Overlays
- Parse prod overlay/architecture.yaml to resolve:
  - globalAddressName for LB frontend
  - certificate reference (compute managed or certificate manager)
  - domain hostRules/pathMatchers expected in url-map YAML
- Brat preflight: ensure certificate status ACTIVE; fail if not ACTIVE

2) Validate Existing Resources (Describe-only)
- GCloud describe for:
  - compute addresses (global)
  - managed ssl certificate/certificate manager resource
  - current URL map (if any)
- Record baselines in request-log.md

3) Plan LB Apply (No Change Execution First)
- Run brat infra plan lb --env=prod
- Ensure data-sourcing mode is active (use-existing) and no creations are planned for IP/cert

4) Guarded URL Map Diff & Dry-Run Import
- Compute desired YAML (from generator outputs in repo under infrastructure/cdktf/lb/url-maps/prod/url-map.yaml)
- Describe current state; produce human-readable diff artifact
- Execute import in --dry-run to verify permissions and steps

5) Production Change Window: Apply + Import
- With approval, run brat infra apply lb --env=prod
- Execute guarded importer (no --dry-run) if drift exists; re-describe post-import
- Validate forwarding rule IP and cert binding

6) DNS & Cert Readiness Validation
- Confirm DNS records point to the expected global IP
- Confirm SSL certificate ACTIVE and serving for all SANs
- Perform synthetic checks against critical routes

7) Observability & Protection
- Verify backend logging entries for test requests
- If Cloud Armor policy defined, attach and validate allow/deny behavior (non-disruptive test)

8) Rollback Plan
- If import introduces issues: re-import last known-good YAML
- If forwarding rule/proxy incorrect: revert to previous version of configuration
- If certificate validation fails: detach and restore previous cert mapping

9) Publication & Verification
- Update verification-report.md with completed checklist
- Validate planning artifacts via validate_deliverable.sh
- Open PR per publication.yaml

## 5. Acceptance Criteria
- LB stack successfully applied in prod using existing IP and cert (no creations for these)
- Guarded importer executes with zero unexpected drift post-import
- DNS resolves to LB global IP; TLS serves ACTIVE cert
- Logging confirmed for backend services; optional Cloud Armor attached if scoped
- PR created with links to all Sprint 12 artifacts and verification report

## 6. Testing & Validation Strategy
- Unit/CLI Validation
  - Run URL map renderer on prod config; ensure deterministic YAML (no diff on re-render)
  - Run guarded importer with --dry-run to ensure describe/diff works without side effects
- Integration Validation (manual/controlled)
  - After apply, run smoke tests for hostRules and core paths
  - Confirm health via Cloud Logging and HTTP 200s on routes
- CI/GCB Hooks
  - cloudbuild.infra-plan.yaml runs plan for prod (never apply) and dry-run importer
  - Root validate_deliverable.sh must succeed

## 7. Risks & Mitigations
- Certificate not ACTIVE at cutover: preflight gate; abort; re-check DNS, ownership
- URL map import drift loop: normalize YAML renderer; lifecycle ignore_changes; manual freeze if needed
- DNS propagation delays: maintain low TTL before change; staged rollout; rollback file ready
- Cloud Armor misconfiguration: start with logging-only policy if supported; apply deny rules later

## 8. Definition of Done (Sprint 12)
- Production LB using existing IP/cert; URL map imported; tests pass
- DNS validated; rollback steps documented and tested in dry-run
- Observability confirmed; optional Armor attached per scope
- Publication via PR with verification-report.md, retro.md, and updated sprint-manifest.yaml

## 9. Traceability
- Aligns to planning/sprint-6-d7e4b0/network-lb-implementation-plan.md (Sprint 12)
- YAML-first URL map strategy per planning/sprint-6-d7e4b0/network-and-lb-technical-architecture.md §5.3

## 10. Remaining Open Items (Project-wide)
- Ensure brat preflight enforcement for VPC connectors is fully enabled and CI blocks --allow-no-vpc in protected branches
- Finalize environment overlays for network connector CIDR sizing and API enablement docs
- Expand integration tests to include multi-region failover scenarios and weighted backends
- Add runbooks for LB change management and on-call procedures

# Sprint 12 Retro — sprint-12-f2b7a8

Date: 2025-11-15
Owner: Lead Implementor

## What Went Well
- Implemented LB preflight checks that enforce use-existing IP/cert and ACTIVE cert status in prod apply.
- Eliminated 409 conflicts by switching IP/cert to data sources and respecting architecture.yaml values.
- Stabilized connectors synthesis using network + /28 ip_cidr_range with min/max instances set to 2.
- Automated non‑prod URL map import post‑apply while keeping prod import guarded.

## What Could Be Improved
- Root validation script should include infra dry-run checks to catch drift earlier in local runs.
- Environment overlays for network and connector CIDRs should be wired into synth instead of hardcoded defaults.
- Expand URL map renderer tests to cover weighted backends and header-based routes.

## Action Items
- Add env overlay consumption for connector and subnet CIDRs in synth (follow-up).
- Extend root validate_deliverable.sh to run brat infra plan and urlmap import --dry-run.
- Document Certificate Manager path as an alternative in preflight (if adopted).

## Links
- Execution Plan: planning/sprint-12-f2b7a8/execution-plan.md
- Implementation Plan: planning/sprint-12-f2b7a8/implementation-plan.md
- Verification Report: planning/sprint-12-f2b7a8/verification-report.md
- Publication: planning/sprint-12-f2b7a8/publication.yaml
- Manifest: planning/sprint-12-f2b7a8/sprint-manifest.yaml

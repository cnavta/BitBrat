# Sprint 9 — Open Items and Unimplemented Tasks (sprint-9-b9f8c1)

Date: 2025-11-13
Role: Lead Implementor
Source of Truth: architecture.yaml
Upstream References:
- planning/sprint-9-b9f8c1/execution-plan.md
- planning/sprint-6-d7e4b0/network-lb-implementation-plan.md (Sprint 8 scope realigned to Sprint 9)
- planning/sprint-6-d7e4b0/network-and-lb-technical-architecture.md

Purpose
- Answer: “Are there any open or unimplemented tasks remaining for Sprint 9 per the plan?”
- Provide a concise, review-ready checklist mapped to the Sprint 9 execution plan deliverables and acceptance criteria.

Summary
- The brat synth now generates a working Terraform configuration for the Network MVP (VPC, Subnet with Private Google Access, Router, NAT, baseline Firewalls) and tests are present for schema and synth content. CI remains plan-only and apply is guarded — all by design.
- Outputs are now defined and captured; optional GCS backend is available behind a guard; verification runbook and evidence template added. CI behavior unaffected.

Open Items (mapped to execution-plan.md)

1) CDKTF Module Source Parity
- [x] Decision: Treat HCL synth (via brat) as the accepted implementation for the Network stack this sprint. Execution plan updated to reflect this. CDKTF app parity deferred. See execution-plan.md §2.

2) Remote Terraform State (GCS) and Workspaces
- [x] Added optional GCS backend block guarded by env var BITBRAT_TF_BACKEND_BUCKET and disabled in CI; per-env workspace selection implemented in terraform provider. Documented bootstrap in runbook. (CI safety preserved.)

3) Outputs Surfacing
- [x] Terraform now defines outputs: vpcSelfLink, subnetSelfLinkByRegion, routersByRegion, natsByRegion.
- [x] brat captures `terraform output -json` after apply and writes infrastructure/cdktf/out/network/outputs.json; CLI prints path or JSON when --json.

4) Tests
- [x] Added stability test (synth twice => identical) approximating snapshot behavior.
- [x] Extended network synth test to assert output blocks and naming conventions.

5) Verification Runbook (Manual Checks)
- [x] Added network-verify-runbook.md with explicit gcloud describe commands and steps.

6) Local Apply Evidence (Dev)
- [ ] Operator action required. Added local-apply-evidence.md template; to be completed outside CI after a supervised apply.

Contextual Notes and Deviations
- The current implementation favors a direct HCL synth from brat over using CDKTF TypeScript app code. This was chosen to minimize moving parts in CI and unblock plan-mode validation. If we keep this approach, update the execution-plan to reflect “HCL synth as implementation” and adjust DoD accordingly.
- Remote state is intentionally omitted to keep CI predictable in plan mode. We can gate backend activation behind an environment flag or per-developer toggle.

Next Steps to Close Sprint 9
- Prioritize: (1) Outputs surfacing, (2) Snapshot test, (3) Verification runbook, then (4) Optional CDKTF app source parity, (5) Remote state enablement behind a guard, (6) Local apply evidence.
- With these completed, Sprint 9 acceptance criteria will be satisfied without introducing CI risk.

Traceability
- This checklist derives from: planning/sprint-9-b9f8c1/execution-plan.md §§3–7 and acceptance criteria in §5.

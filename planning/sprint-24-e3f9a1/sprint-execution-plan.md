Welcome to Sprint 24 — Migration, CI and Documentation

Role: Lead Implementor
Source of Truth: architecture.yaml
Upstream Design/Plans:
- planning/sprint-17-f7c3a2/technical-architecture-lb-routing-from-infrastructure-resources.md
- planning/sprint-17-f7c3a2/implementation-plan-lb-routing-from-infrastructure-resources.md

Date: 2025-11-19

1. Objective & Scope
- Finalize migration away from lb.services[] to routing-driven configuration under infrastructure.resources.<lb>.routing.
- Extend CI validation to include buckets module plan and ensure local validate_deliverable.sh mirrors CI steps.
- Update documentation and runbooks, including migration notes and assets proxy expectations.

Out of Scope
- Implementing new infrastructure beyond planning/CI steps (no production applies).
- Building or deploying the assets-proxy service itself; only document expectations.

2. Deliverables
- CLI and Warnings
  - Ensure when both routing-driven LB and lb.services[] are present, a deprecation warning is emitted and routing is preferred.
  - Optional diagnostic command design/spec to list derived backends from routing (implemented later if feasible).
- CI
  - Update cloudbuild.infra-plan.yaml to add a plan step for the buckets module.
  - Update root validate_deliverable.sh to include buckets plan in dry-run.
- Documentation
  - planning/index.md updated with links to the upstream design and this sprint.
  - Migration notes for moving from lb.services[] to routing-driven configuration.
  - Assets proxy expectations (service name convention and IAM for bucket access).

Artifacts Produced in this Sprint Folder
- sprint-manifest.yaml
- backlog.md (trackable items with estimates and dependencies)
- request-log.md (prompt traceability)
- validate_deliverable.sh (local validation for planning artifacts)

3. Acceptance Criteria
- CI plans include buckets module and pass in dry-run.
- Local validation script runs successfully and includes the buckets plan step.
- Deprecation warning behavior is documented and visible in logs for legacy configs where both mechanisms are present.
- Documentation updated in planning/index.md and migration notes exist in this sprint folder.

4. Testing Strategy
- Unit tests exist in prior sprints for schema/synth/renderer/importer. This sprint focuses on CI pipeline validation and documentation.
- Add or adjust minimal Jest tests as needed only if warning behavior requires code changes; otherwise, validate via CI dry-run and log inspection.

5. Deployment Approach
- No production applies. Only dry-run plans in Cloud Build and local validate script.
- Any importer operates in guarded mode per environment policies established in previous sprints.

6. Dependencies
- Prior sprints 20–23 (schema validation, buckets module, routing-driven backends, renderer/importer updates).
- GCP project, Terraform and gcloud CLIs available in CI images.

7. Risks & Mitigations
- Legacy configurations still relying on lb.services[]: Provide clear deprecation warning and migration notes; prefer routing when both present.
- Buckets plan step failing due to environment setup: ensure steps are dry-run and gated; provide instructions in docs.

8. Definition of Done (DoD)
- CI configuration updated and validated with dry-run including buckets.
- Root validation script updated to mirror CI.
- Migration and assets proxy documentation committed and linked.
- PR prepared referencing this plan and backlog per Sprint Protocol.

9. Work Breakdown & Milestones
- M1: Add/confirm deprecation warning behavior documentation; define diagnostic command shape.
- M2: Update cloudbuild.infra-plan.yaml with buckets plan step and test CI locally if possible.
- M3: Update root validate_deliverable.sh to include buckets plan; run locally.
- M4: Update planning/index.md and add migration-notes.md in this folder.
- M5: Validate end-to-end locally; prepare PR with links.

10. Verification Plan
- Run validate_deliverable.sh at repo root and ensure buckets plan shows in output (or is simulated in this sprint if guarded).
- Confirm Cloud Build dry-run config is syntactically valid and incorporates the new step.
- Produce a short verification note in PR body summarizing CI output and documentation links.

11. Traceability
- Aligns with architecture.yaml and “Sprint 24 — Migration, CI and Documentation” in the approved implementation plan.

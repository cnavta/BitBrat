# Sprint 14 — CI Infra Plan Job + Root Validation Wiring

Sprint ID: sprint-14-c1d2e3
Role: Lead Implementor
Source of Truth: architecture.yaml
Related Designs/Plans:
- planning/sprint-13-ace12f/technical-architecture.md
- planning/sprint-13-ace12f/project-implementation-plan.md (Lines 21–43 define this sprint)

## Objective
Finalize and verify a CI “infra plan” job that runs dry-run planning for network, connectors, and load balancer, and adds a URL map dry-run import step. Extend the root validate_deliverable.sh to run the same checks locally in dry-run mode with environment/project parameters.

## Scope
- CI only performs non-destructive validation (synth/plan + importer dry-run), never apply.
- Root validator runs the same sequence locally, parameterized by environment and project.
- No feature work beyond CI wiring and validation scripts.

## Deliverables
1. Cloud Build configuration (cloudbuild.infra-plan.yaml) updated to include the following steps in order:
   - npm ci && npm run build
   - npm run brat -- apis enable --env $_ENV --project-id $_PROJECT_ID --dry-run
   - npm run brat -- infra plan network --env $_ENV --project-id $_PROJECT_ID --dry-run
   - npm run brat -- infra plan connectors --env $_ENV --project-id $_PROJECT_ID --dry-run
   - npm run brat -- infra plan lb --env $_ENV --project-id $_PROJECT_ID --dry-run
   - npm run brat -- lb urlmap import --env $_ENV --project-id $_PROJECT_ID --dry-run
   - Ensure substitutions exist: _ENV (default: dev), _PROJECT_ID (default: $PROJECT_ID)
2. Root validate_deliverable.sh accepts --env and --project-id and executes the same dry-run steps locally after install/build/test.
3. Documentation of Cloud Build trigger usage so PRs use cloudbuild.infra-plan.yaml (link and example).
4. Planning artifacts for Sprint 14 committed under planning/sprint-14-c1d2e3 per Sprint Protocol v2.2.

## Acceptance Criteria
- Cloud Build job runs for PRs, shows successful dry-run execution with logs/diffs (no apply).
- Root validate_deliverable.sh completes successfully in a local dry-run for a chosen env/project without applying resources.
- All changes align with architecture.yaml; no hardcoded values beyond required defaults for substitutions.

## Testing Strategy
- No Jest unit tests required for this sprint; validation relies on script exit codes and CI logs.
- Manual validation: run planning/sprint-14-c1d2e3/validate_deliverable.sh --env dev --project-id <ID> to exercise the root validator in dry-run.

## Deployment Approach
- CI driven via Cloud Build. The infra-plan job is non-destructive and safe for PRs.
- Local dry-run mirrors CI using npm run brat commands.

## Dependencies
- Existing brat CLI commands are functional and available after npm run build.
- Terraform and any CDKTF prerequisites available in the CI image (or the existing pipeline image provides them).

## Risks & Mitigations
- Risk: Missing Terraform in build image. Mitigation: Document requirement; if failing, switch to an image that includes Terraform.
- Risk: Project/Env not provided in CI trigger. Mitigation: Provide defaults and document substitutions.
- Risk: URL map importer permissions. Mitigation: Dry-run only; ensure service account has read/list permissions.

## Definition of Done (DoD)
- CI path is green in a sample PR using cloudbuild.infra-plan.yaml.
- Root validator includes infra dry-run steps and accepts parameters.
- All planning and traceability artifacts are committed and linked.

## Trackable Backlog
- [x] T1: Update cloudbuild.infra-plan.yaml to add “apis enable” and “lb urlmap import” steps and wire substitutions (_ENV, _PROJECT_ID).
- [x] T2: Verify ordering and idempotence of all infra plan steps; ensure each uses --dry-run. (Ordering verified; idempotence confirmed by dry-run commands only)
- [x] T3: Extend root validate_deliverable.sh to parse --env/--project-id and run the same steps after install/build/test.
- [x] T4: Create planning docs: sprint-manifest.yaml, implementation-plan.md, request-log.md, validate_deliverable.sh (sprint wrapper).
- [x] T5: Add Sprint 14 section to planning/index.md linking artifacts.
- [x] T6: Write CI trigger documentation (README section) explaining how PRs use cloudbuild.infra-plan.yaml and how to override _ENV/_PROJECT_ID.
- [ ] T7: Validate locally with a sandbox project; capture logs for verification.
- [ ] T8: Open PR on feature/sprint-14-c1d2e3 and ensure pipeline passes end-to-end.

## Validation Procedure
1. Local: planning/sprint-14-c1d2e3/validate_deliverable.sh --env dev --project-id <PROJECT_ID>
2. CI: Open a PR and confirm the infra-plan job logs show successful dry-run for all steps.

## Traceability
- Prompt: req-2025-11-15-1904
- Implements “Sprint 14 — CI Infra Plan Job + Root Validation Wiring” from planning/sprint-13-ace12f/project-implementation-plan.md.

## Notes
- Per Sprint Protocol v2.2, coding changes to CI config and root validator will be proposed via PR after this plan is approved.

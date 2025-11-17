# Sprint 16 Implementation Plan — Fix infra-plan Cloud Build `brat doctor`

## Objective & Scope
- Resolve Cloud Build failure in infra-plan pipeline at step `npm run brat -- doctor` by enabling CI-safe execution.
- Initialize Sprint 16 planning artifacts per LLM Sprint Protocol v2.2.

Out of scope: Reworking builder images for Terraform/gcloud, or full infra plan/apply execution in CI.

## Deliverables
1. Code: `brat doctor` supports a `--ci` flag to skip external CLI checks (gcloud/terraform/docker) while still reporting status.
2. Pipeline: `cloudbuild.infra-plan.yaml` updated to call `brat doctor --json --ci`.
3. Docs: Sprint folders and logs created under `planning/sprint-16-e3f9a1`.

## Acceptance Criteria
- Cloud Build no longer fails on the `Brat doctor` step when run in the npm builder image.
- Running `npm run brat -- doctor --json --ci` exits with code 0 and shows ci-skip markers for gcloud/terraform/docker.
- TypeScript build succeeds; Jest tests (existing) still pass.

## Testing Strategy
- Build and run locally: `npm ci && npm run build`.
- Execute: `node dist/tools/brat/src/cli/index.js doctor --json --ci` and verify exit code 0 with ci-skip markers.
- Ensure downstream infra steps remain dry-run and are unaffected by this change.

## Deployment Approach
- No runtime deployment; this change affects CLI behavior and CI config only.
- Merge via PR and verify Cloud Build.

## Dependencies
- None new. Uses existing Node build.

## Definition of Done (DoD)
- `brat doctor --ci` implemented and documented in CLI help.
- `cloudbuild.infra-plan.yaml` uses the new flag.
- Repository builds and tests pass.
- Planning artifacts created under `planning/sprint-16-e3f9a1`.

## Notes / Trade-offs
- We chose a minimal, explicit `--ci` flag to avoid implicit environment detection.
- Future work may swap the builder image for one that includes gcloud/terraform to run non-skipped checks in CI.

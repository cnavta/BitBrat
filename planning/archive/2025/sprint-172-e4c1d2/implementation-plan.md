# Implementation Plan – sprint-172-e4c1d2

## Objective
Add support for deploying services using images specified in `architecture.yaml` instead of building from source.

## Scope
- `architecture.yaml` parsing logic in `brat` tool.
- Deployment orchestration in `brat` tool.
- New Cloud Build configuration for deploy-only scenarios.

## Deliverables
- Updated `tools/brat/src/config/schema.ts`
- Updated `tools/brat/src/config/loader.ts`
- Updated `tools/brat/src/cli/index.ts`
- New `cloudbuild.deploy-only.yaml`
- Technical Architecture document (already created)

## Acceptance Criteria
- Services with an `image` property in `architecture.yaml` can be deployed using `brat deploy services <name>`.
- Build steps (npm install, docker build, etc.) are skipped for such services.
- Services without an `image` property still build and deploy as before.
- `brat deploy services <name> --dry-run` shows the correct `cloudbuild.deploy-only.yaml` and image URL.

## Testing Strategy
- **Manual Verification**: Run `brat` with `--dry-run` and inspect logs.
- **Unit Tests**: Add tests for schema validation and service resolution if needed (existing tests in `tools/brat/src/config/` can be extended).

## Definition of Done
- Code quality adheres to project standards.
- `npm test` passes in `tools/brat`.
- `validate_deliverable.sh` passes.
- PR created and pushed.

## Dependencies
- GCP credentials for Cloud Build/Run (for real deployment verification, but dry-run can be used for initial validation).

# Implementation Plan – sprint-210-9b4e1a

## Objective
Enable running direct image references from `architecture.yaml` service definitions in the local Docker Compose environment. This will allow services like `obs-mcp`, which use pre-built images, to be part of the local development stack.

## Scope
- Modify `infrastructure/scripts/bootstrap-service.js` to handle services with an `image` field.
- Update `generateComposeSource` to use the `image` field if available, instead of building from a `Dockerfile`.
- Ensure environment variables and secrets defined in `architecture.yaml` for image-based services are correctly propagated to the compose file.
- Support bootstrapping for services that only have an `image` (skipping source code and Dockerfile generation).

## Deliverables
- Modified `infrastructure/scripts/bootstrap-service.js`.
- Generated `infrastructure/docker-compose/services/obs-mcp.compose.yaml`.
- Updated documentation if necessary.

## Acceptance Criteria
- `npm run bootstrap:service -- --name obs-mcp` successfully creates a compose file in `infrastructure/docker-compose/services/`.
- The generated `obs-mcp.compose.yaml` uses the `image` defined in `architecture.yaml`.
- `npm run local -- --service-name obs-mcp` attempts to start the service using the specified image.
- Existing `entry`-based services still bootstrap and run correctly.

## Testing Strategy
- Manual verification of generated compose files.
- Run `validate_deliverable.sh` which will:
    - Bootstrap a service with an `image`.
    - Verify the content of the generated compose file.
    - Dry-run `npm run local` to ensure it picks up the new compose file.

## Deployment Approach
- Local script modification. No cloud deployment changes required for this sprint, although the `image` references are intended to align with what runs in GCP.

## Dependencies
- `architecture.yaml` as the source of truth for service definitions.
- `docker-compose` and `docker` for local execution.

## Definition of Done
- Code quality adheres to project standards.
- Tests (manual and scripted) pass.
- `validate_deliverable.sh` is logically passable.
- Verification report and retro completed.
- Pull Request created.

# Implementation Plan – sprint-142-d6e8f1

## Objective
- Fix the issue where `BaseServer.loadArchitectureYaml()` returns null in the `oauth-flow` service.
- Ensure all services can correctly resolve the load balancer base URL from `architecture.yaml`.

## Scope
- `Dockerfile.oauth-flow`
- `src/services/oauth/providers/twitch-adapter.ts`
- `src/services/oauth/providers/discord-adapter.ts` (verification)
- `src/services/twitch-oauth.ts`
- `src/common/base-server.ts`

## Deliverables
- Updated `Dockerfile.oauth-flow` with `architecture.yaml`.
- Fixed property access in `twitch-adapter.ts` and `twitch-oauth.ts`.
- New unit test for `BaseServer.loadArchitectureYaml`.

## Acceptance Criteria
- `BaseServer.loadArchitectureYaml()` returns the parsed YAML when `architecture.yaml` is present in the expected locations.
- `DiscordAdapter` and `TwitchAdapter` can resolve the load balancer base URL correctly.
- `oauth-flow` service Docker image contains `architecture.yaml`.

## Testing Strategy
- Unit test for `BaseServer.loadArchitectureYaml` using `jest`.
- Manual verification of path resolution in the code.

## Deployment Approach
- Update Dockerfile, which will be picked up by the next Cloud Build run.

## Dependencies
- None.

## Definition of Done
- Code adheres to project constraints.
- `npm test` passes.
- PR created and linked in `publication.yaml`.
- `validate_deliverable.sh` passes.

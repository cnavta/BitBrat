# Implementation Plan – sprint-205-d8f1a2

## Objective
Migrate the legacy `bootstrap:service` script into the `brat` tool as a native command: `npm run brat -- service bootstrap <name>`. The new implementation will be in TypeScript, integrated into the `brat` CLI structure, and enhanced to support modern standards including `McpServer` base class usage and cloud-ready deployment artifacts.

## Scope
- Porting core logic from `infrastructure/scripts/bootstrap-service.js` to `tools/brat/src/cli/bootstrap.ts` (or similar).
- Registering the command in `tools/brat/src/cli/index.ts`.
- Updating templates for:
  - App entry point (using `McpServer` or `BaseServer`).
  - Unit tests.
  - `Dockerfile.<service>`.
  - `infrastructure/docker-compose/services/<service>.compose.yaml`.
- Ensuring `architecture.yaml` integration (reading entry point, description, etc.).

## Deliverables
- New command implementation in `brat` tool.
- Unit tests for the new `brat` command.
- Updated `package.json` (optional, if we want to alias `bootstrap:service` to `brat`).
- Documentation update in `brat` help output.

## Acceptance Criteria
- `npm run brat -- service bootstrap --name test-svc` generates all expected files.
- Generated service compiles and starts locally.
- Use of `--mcp` flag correctly toggles `McpServer` base class.
- Generated Dockerfile builds successfully.
- Command correctly reads from `architecture.yaml`.

## Testing Strategy
- Integration tests in `brat` tool: Invoke the bootstrap command and verify file existence/content.
- Manual verification: Build and run a bootstrapped service.

## Deployment Approach
- The tool itself is part of the development environment.
- Generated artifacts (Dockerfiles) are used by Cloud Build.

## Dependencies
- `js-yaml` (already in project).
- `zod` (for `McpServer` registration).

## Definition of Done
- Implementation plan approved.
- Code implemented and tested.
- `validate_deliverable.sh` passes.
- PR created.

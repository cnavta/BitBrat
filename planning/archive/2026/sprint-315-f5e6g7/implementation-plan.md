# Implementation Plan – sprint-315-f5e6g7

## Objective
Implement remote Docker engine support in the `brat` tool, enabling seamless Docker Compose deployments via SSH or `DOCKER_HOST`.

## Scope
- Porting orchestration logic from `deploy-local.sh` and `merge-env.js` to TypeScript within `tools/brat`.
- Extending `brat` CLI with `brat docker` command group (`up`, `down`, `logs`, `ps`).
- Updating `architecture.yaml` schema for `deploymentTargets`.
- Implementing SSH-based connection orchestration for the Docker CLI.
- Supporting "Remote Build" image distribution strategy.

## Deliverables
- `tools/brat/src/orchestration/docker`: New orchestration module.
- `tools/brat/src/cli/docker.ts`: New CLI commands.
- Updated `architecture.yaml` and its loader in `brat`.
- `validate_deliverable.sh`: Automated validation script for the sprint.
- Documentation updates (if applicable).

## Acceptance Criteria
- `brat docker up --target local` replicates `deploy-local.sh` behavior.
- `brat docker up --target remote-vps` successfully initiates a deployment to a mock or real remote host via SSH.
- `architecture.yaml` supports `deploymentTargets` with `host`, `env`, and `context`.
- Environment variables are correctly merged and applied to remote containers.

## Testing Strategy
- **Unit Tests**: Test the `EnvironmentResolver`, `ComposeFactory`, and `PortManager` logic.
- **Integration Tests**: Mock the Docker CLI and SSH commands to verify correct command string generation and environment variable injection.
- **Manual Verification**: Run `brat docker up` against a local and (if available) a remote test engine.

## Deployment Approach
- The `brat` tool is distributed as a local CLI tool or via internal package registry.
- Deployment targets are configured in the project's `architecture.yaml`.

## Dependencies
- Docker CLI installed on the host.
- SSH client and keys for remote access.
- `architecture.yaml` for configuration.

## Definition of Done
- All code follows project standards and `architecture.yaml` constraints.
- `validate_deliverable.sh` passes.
- Unit and integration tests cover new behavior.
- PR created and verification report completed.

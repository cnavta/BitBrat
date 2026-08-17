# Implementation Plan – sprint-228-d4e5f6

## Objective
Create an `npm run brat -- chat` based tool that allows direct, interactive chatting with the platform via the command line, utilizing the `api-gateway` and other available platform tools.

## Scope
- Update `architecture.yaml` to expose `api-gateway`.
- Extend `brat` CLI in `tools/brat/src/cli/index.ts` with a `chat` command.
- Implement the interactive chat session logic in `tools/brat/src/cli/chat.ts`.
- Ensure proper authentication and connection management.
- Support overriding the WebSocket URL via a command-line argument.
- Correct `egress.destination` metadata in `api-gateway` to support multi-instance routing.
- Remediate `api-gateway` log spam by introducing a `trace` log level.
- Fix `brat chat` egress payload selection to avoid echoing input messages.
- Add persistence finalization logic to `api-gateway`.
- Fix duplicate response delivery by adding missing ACKs in `api-gateway` egress handlers.
- Map `egress.deliver.v1` to `chat.message.received` in `api-gateway` for better CLI output.

## Deliverables
- Code changes in `tools/brat/src/cli/index.ts`.
- New file `tools/brat/src/cli/chat.ts`.
- Updated `architecture.yaml`.
- Corrected metadata in `src/apps/api-gateway.ts` and `src/services/api-gateway/ingress.ts`.
- New log level `trace` in `src/common/logging.ts` and `src/types/index.ts`.
- Fixes in `src/services/api-gateway/egress.ts` for payload selection.
- Finalization logic in `src/apps/api-gateway.ts`.
- Documentation: `planning/sprint-228-d4e5f6/technical-architecture.md`.
- Tests for the new CLI command, chat logic, and metadata correction.

## Acceptance Criteria
- Running `npm run brat -- chat` starts an interactive console session.
- The session connects to the `api-gateway` via WebSocket.
- Messages sent from the CLI are received by the platform.
- Messages from the platform are displayed in the CLI.
- Authentication works using an API token.
- Commands like `/exit` and `/help` work as expected.
- Users can specify a custom WebSocket URL using the `--url` flag.

## Testing Strategy
- Unit tests for `parseArgs` in `index.ts` to ensure `chat` command is correctly parsed.
- Integration tests using a mock WebSocket server to verify connection, authentication, and message exchange in `chat.ts`.
- Manual verification using the local `api-gateway` and the `auth` service to generate a token.

## Deployment Approach
- The CLI tool itself does not need deployment (it's a developer tool).
- The `api-gateway` service needs its load balancer routing updated via `brat infra apply lb --env <env>`.

## Dependencies
- `ws`: WebSocket client (already in `package.json`).
- `readline`: Node.js built-in module for terminal I/O.
- `uuid`: For generating correlation IDs (already in `package.json`).

## Definition of Done
- All deliverables implemented.
- All tests passing.
- `validate_deliverable.sh` executes successfully.
- Technical Architecture and Implementation Plan documented.
- PR created.

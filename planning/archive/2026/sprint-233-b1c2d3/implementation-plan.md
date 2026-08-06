# Implementation Plan - Fix Brat Chat Port Mismatch (sprint-233-b1c2d3)

## Objective
Ensure the `brat chat` command connects to the correct port for the `api-gateway` in the local environment, respecting any dynamic port assignments from `deploy-local.sh` or manual configuration.

## Scope
- Modify `tools/brat/src/cli/chat.ts` to check for `API_GATEWAY_HOST_PORT` environment variable.
- Ensure fallback to `3001` remains if no port is specified.

## Deliverables
- Code fix in `tools/brat/src/cli/chat.ts`.
- Reproduction/Validation test in `tools/brat/src/cli/__tests__/chat.test.ts`.

## Acceptance Criteria
- `brat chat` connects to `ws://localhost:${API_GATEWAY_HOST_PORT}/ws/v1` when the environment variable is set.
- `brat chat` defaults to `ws://localhost:3001/ws/v1` when it is not set.

## Testing Strategy
- Add a new test case to `tools/brat/src/cli/__tests__/chat.test.ts` that mocks `process.env.API_GATEWAY_HOST_PORT` and verifies the resulting WebSocket URL.
- Manual verification: Run `API_GATEWAY_HOST_PORT=4000 npm run brat -- chat` and check the "Connecting to..." output.

## Definition of Done
- Implementation complete.
- Tests passing.
- PR created.

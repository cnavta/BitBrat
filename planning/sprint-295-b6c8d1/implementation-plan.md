# Implementation Plan – sprint-295-b6c8d1

## Objective
Synchronize timeout layers across the MCP tool invocation path to resolve zombie executions and failed interactions. Implement a "Top-Down" hierarchy:
- Layer 1: Event/Bus (QoS) -> 90s
- Layer 2: Application (LLM Bot) -> 75s
- Layer 3: Infrastructure (ProxyInvoker) -> 60s

## Scope
- `src/common/mcp/proxy-invoker.ts`: Update JSDoc, fix `optionsOverride` logic, add specific error logging.
- `src/apps/llm-bot-service.ts`: Update `CONFIG_DEFAULTS.OPENAI_TIMEOUT_MS` to 75000.
- `src/services/llm-bot/processor.ts`: Update fallback `timeoutMs` to 75000.
- `src/common/base-server.ts`: Update documentation regarding QoS defaults.
- Testing: Unit tests for `ProxyInvoker` and integration tests for timeout alignment.

## Deliverables
- Code modifications to align timeouts.
- Fix regression in `prompt-logging.test.ts`.
- Improved logging in `ProxyInvoker`.
- Unit and Integration tests.
- `validate_deliverable.sh` script.

## Acceptance Criteria
- [ ] `ProxyInvoker` defaults to 60s timeout and 120s reset in code AND JSDoc.
- [ ] `LlmBotServer` defaults to 75s for `OPENAI_TIMEOUT_MS`.
- [ ] `processor.ts` defaults to 75s if no config is present.
- [ ] `ProxyInvoker` logs clearly distinguish between "Upstream Timeout" and "Caller Abort".
- [ ] Unit tests verify `ProxyInvoker` respects overrides and defaults.
- [ ] Integration test verifies a 45s tool call succeeds through the 75s Bot and 60s Proxy.

## Testing Strategy
- **Unit Tests**: Test `ProxyInvoker.wrapCall` with mocked timers and functions to verify timeout triggers and error types.
- **Integration Tests**: Use a mock MCP server that delays responses to verify the hierarchy works as expected.

## Deployment Approach
- Standard Cloud Build / Cloud Run deployment.
- No infrastructure changes required beyond configuration defaults.

## Dependencies
- Model Context Protocol (MCP) SDK.
- BitBrat `BaseServer` and event infrastructure.

## Definition of Done
- All code changes implemented and reviewed.
- All tests pass locally and in CI.
- Documentation updated.
- `validate_deliverable.sh` successful.
- PR created and linked in manifest.

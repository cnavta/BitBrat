# Implementation Plan – sprint-175-b2c4a6

## Objective
Investigate and fix issues preventing the bot from using MCP tools after the transition to the Firestore registry.

## Scope
- `src/services/llm-bot/processor.ts`: Fix tool parameter mapping for AI SDK.
- `src/services/llm-bot/mcp/client-manager.ts`: Improve observability of tool registration.
- `tests/services/llm-bot/processor-tools.spec.ts`: New reproduction/verification test.

## Deliverables
- Bug fix in `processor.ts` mapping `inputSchema` to `parameters`.
- Additional logging in `processor.ts`.
- New unit test for tool passing.

## Acceptance Criteria
- [x] Reproduction test confirms tools were missing `parameters` field.
- [x] Fix ensures `parameters` field is correctly populated from `inputSchema`.
- [x] All existing tests pass.
- [x] `validate_deliverable.sh` passes.

## Testing Strategy
- Create a specific unit test in `tests/services/llm-bot/processor-tools.spec.ts` that mocks `generateText` and verifies the structure of the `tools` object passed to it.
- Run full suite of `llm-bot` tests.

## Definition of Done
- Code changes verified by tests.
- PR created.
- Sprint artifacts (manifest, log, plan, report, retro) completed.

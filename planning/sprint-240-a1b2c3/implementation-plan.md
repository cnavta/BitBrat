# Implementation Plan – sprint-240-a1b2c3

## Objective
Implement expanded MCP usage visibility by logging tool/resource invocations and enhancing debug reporting.

## Scope
- `src/services/llm-bot/processor.ts`: Logging logic and personality capture.
- `src/services/llm-bot/mcp/stats-collector.ts`: Add `errorRate` and latency reporting.
- `src/apps/llm-bot-service.ts`: Update `/_debug/mcp` if needed (likely just uses stats-collector changes).

## Deliverables
- Updated `processor.ts` with expanded `prompt_logs` entries.
- Updated `McpStatsCollector` with better metrics.
- Tests verifying that tool calls are correctly logged to Firestore.

## Acceptance Criteria
- Every LLM interaction with tool calls results in a `prompt_logs` document containing `toolCalls` array.
- `prompt_logs` document contains `personalityName` (if applicable).
- `GET /_debug/mcp` returns `errorRate` for each tool.
- Errors during tool execution are captured in `prompt_logs`.

## Testing Strategy
- **Unit Tests**: Update `src/services/llm-bot/__tests__/processor.ts` (if exists) or create a new test to verify logging.
- **Integration Tests**: Verify Firestore writes with mock Firestore.
- **Manual Verification**: Run `llm-bot` locally, trigger a tool call, and check Firestore (simulated).

## Deployment Approach
- Standard Cloud Build / Cloud Run deployment.

## Dependencies
- Firestore (existing).
- Vercel AI SDK (existing).

## Definition of Done
- All code changes follow project style.
- `validate_deliverable.sh` passes.
- PR created.

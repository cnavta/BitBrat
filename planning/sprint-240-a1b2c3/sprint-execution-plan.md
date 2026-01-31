# Sprint Execution Plan – sprint-240-a1b2c3

## Phase 1: Foundation & Metrics
- Update `McpStatsCollector` to include `errorRate` calculation and ensure all latency metrics are properly initialized and reported.
- Verify `/_debug/mcp` endpoint picks up these changes automatically.

## Phase 2: Personality Capture
- Modify `processor.ts` to extract and store personality names during the resolution phase.
- Ensure these names are available in the scope of the logging block.

## Phase 3: Tool Call Capture & Logging
- Modify `processor.ts` to extract `toolCalls` and `toolResults` from the `generateText` result.
- Update the Firestore `prompt_logs.add` call to include `personalityName`, `toolCalls` (mapped and redacted), and any errors.
- Ensure resource access is considered (even if just a placeholder/empty array for now if not active).

## Phase 4: Validation & Verification
- Create a test case that mocks tool execution and verifies the Firestore document structure.
- Run `validate_deliverable.sh`.
- Generate verification report and retro.

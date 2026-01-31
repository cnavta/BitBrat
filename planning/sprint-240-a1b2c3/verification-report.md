# Deliverable Verification – sprint-240-a1b2c3

## Completed
- [x] **Tool Invocations Logging**: Every tool call and result is now logged in the `prompt_logs` collection.
- [x] **Parameters (Args) Logging**: Tool arguments are now stringified, redacted, and logged alongside results.
- [x] **Personality Name Logging**: Personality names used during interaction are captured and logged.
- [x] **Error Tracking**: Tool errors are captured in the `toolCalls` array within `prompt_logs`.
- [x] **Debug Endpoint Enhancements**: `/_debug/mcp` now includes `errorRate` and consistent latency metrics for tools and servers.
- [x] **Redaction**: All tool results logged to Firestore are passed through `redactText`.
- [x] **Fallback for Non-Text Tool Results**: MCP tools returning non-textual or complex content now have their full result logged to Firestore as a stringified object, instead of an empty string.
- [x] **Whitespace Handling in Tool Results**: Improved `McpBridge` to treat whitespace-only text parts as empty, triggering the fallback to the full content object for better visibility.

## Tests
- `tests/services/llm-bot/mcp-visibility.test.ts`: Verified personality names and tool calls/results/args/errors logging.
- `tests/services/llm-bot/mcp-stats.test.ts`: Verified `errorRate` and latency calculations in `McpStatsCollector`.
- Manual verification with reproduction test (args logging and redaction, complex/non-text results, and whitespace-only results are correctly captured and stringified).
- All `src/services/llm-bot` tests passed (19 suites).

## Alignment Notes
- Logged `personalityNames` as an array to handle cases where multiple personalities are resolved.
- Tool `durationMs` is recorded in `McpStatsCollector` but not yet added to the individual `toolCalls` log in `prompt_logs` because the AI SDK `toolResults` doesn't provide it out of the box. Future enhancement could involve timing the individual `execute` wrappers.

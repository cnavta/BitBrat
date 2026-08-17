# Retrospective – sprint-298-e7a8b9

## What Worked
- The `StreamBuffer` utility effectively decoupled event normalization from the main engine.
- Using `McpServer` base class allowed quick exposition of the `summarize_stream` tool.
- Unit testing with mocked LLM responses verified the parsing logic for both Markdown and JSON (inspection).

## Challenges
- `Prompt Assembly Framework` (v2) doesn't natively render `outputFormat` instructions, so these had to be manually appended to the task instructions.
- Firestore composite index requirement for `ingressAt` filtering was identified and added.

## Lessons Learned
- When creating a new service that is also an MCP server, ensuring it fits into the existing `tool-gateway` discovery mechanism (via `mcp_servers` collection) is crucial.
- `js-tiktoken` is a very useful dependency already present in the project for token-aware truncation.

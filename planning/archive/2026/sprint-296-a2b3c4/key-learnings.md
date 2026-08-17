# Key Learnings - sprint-296-a2b3c4

- **Payload Awareness:** Large payloads in MCP tool responses can cause timeouts even if the processing succeeds, due to transport and serialization/deserialization overhead.
- **Consumption Gaps:** Always verify how a tool response is consumed by the caller (`llm-bot` via `McpBridge`). Sending data that is discarded by the consumer is pure waste and a reliability risk.
- **Ephemeral vs. Persistent:** When providing a persistent URL (GCS), the need for an ephemeral inline payload (base64) should be strongly justified. In this case, it was redundant.
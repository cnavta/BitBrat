# Key Learnings – sprint-301-c7d8e9

1. **Routing-Based Mode Activation:** Routing slips in `InternalEventV2` are a powerful way to change downstream service behavior (e.g., `llm-bot` Narrator mode) without changing the event payload.
2. **MCP Tool Reuse:** Building the logic as MCP tools from the start ensures that future Phase 2/3 integrations (like Channel Point redeems) can reuse the same core logic.
3. **Firestore Schema:** The `stories/{storyId}/snapshots` pattern is essential for auditability and potential "undo" features.

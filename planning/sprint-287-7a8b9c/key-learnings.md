# Key Learnings – sprint-287-7a8b9c

- **Tool Categorization:** Explicitly labeling tools as `basic:`, `internal:`, and `mcp:` improves readability of both logs and the LLM's tool context.
- **Local Tooling Architecture:** Stateless, low-latency tools belong in the same process as the LLM orchestrator whenever possible to avoid unnecessary network hops.
- **Scalability of Basic Tools:** The pattern of using creation functions (e.g., `createGetCurrentTimeTool()`) and then registering them in a registry is highly scalable for adding more functionality.

# Key Learnings - sprint-241-b8d4e2

- **Sidecar Lifecycle**: Native Cloud Run multi-container support is much more efficient than managing separate services for high-bandwidth/low-latency LLM sidecars.
- **Structured LLM Output**: Using Ollama's `format: "json"` is a game-changer for reliable middleware services compared to regex-based text parsing.
- **Adaptive Routing**: The combination of `BaseServer.next()` and `BaseServer.complete()` provides a clean, standardized way to handle both enrichment and short-circuiting.

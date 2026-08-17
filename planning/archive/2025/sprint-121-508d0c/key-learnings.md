# Key Learnings – sprint-121-508d0c

- LangGraph.js Annotation.Root greatly simplifies state typing and node return shapes.
- Keep OpenAI SDK options (like AbortSignal) out of the request body; pass via second param.
- Implementing a minimal, composable graph early reduces refactor cost as complexity grows.
- Provide test-friendly server adapters and disable external I/O in CI to avoid flakiness.
- Routing slip helpers and BaseServer.next semantics should be exercised in integration-style tests next.

# Key Learnings – sprint-177-a1b2c3

- **Tool Extensibility**: Adding a generic `context` object to the tool execution signature is a powerful pattern for future administrative features (e.g., passing session tokens, language preferences, etc.).
- **Role-Based Tool Discovery**: Centralizing the role check logic in `list_available_tools` ensures consistency. We should consider if the LLM should also have a system-level role filter before it even tries to call a tool, which we already implemented in `processor.ts`.
- **Bot as Admin UX**: This sprint confirmed that providing the LLM with tools to query its own state is a viable path for the administrative dashboard.

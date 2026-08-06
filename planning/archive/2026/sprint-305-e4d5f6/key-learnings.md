# Key Learnings – sprint-305-e4d5f6

- **Tool Scoping**: Scoping is an effective way to reduce LLM tool choice overload without sacrificing functionality.
- **MCP Extension**: Custom fields in MCP `listTools` responses are a viable way to pass platform-specific metadata like `scopes`.
- **Global Tools**: Always identifying a set of "global" tools (identity, help, status) is crucial to maintain bot usability regardless of current scope.
- **Metadata vs Annotations**: While annotations are good for instructions, `metadata` is often better for deterministic routing and filtering flags.

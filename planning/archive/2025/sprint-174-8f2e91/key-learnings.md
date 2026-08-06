# Key Learnings – sprint-174-8f2e91

1. **Telemetry Wrapping**: Wrapping tool execution at the registry or processor level is more flexible than adding telemetry inside each tool implementation, especially when dealing with multi-source tools (MCP, Firestore, etc.).
2. **In-Memory vs Persistent Stats**: For rapid prototyping, in-memory stats are sufficient, but process restarts lose all data. If long-term uptime or reliability trends are needed, Firestore aggregation is essential.
3. **TypeScript Strictness**: Always check interface definitions when implementing complex state objects to avoid runtime errors or compilation failures from property name mismatches.

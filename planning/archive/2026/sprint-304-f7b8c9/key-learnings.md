# Key Learnings - sprint-304-f7b8c9

- **TypeScript Strictness**: Be careful with `null` vs `undefined` when using third-party libraries or internal services that might return `null`.
- **WebSocket Testing**: Mocking `WebSocket` servers and clients in Jest requires careful handling of the `http.Server` and `WebSocketServer` lifecycle to avoid open handles.
- **Sprint Protocol**: Following the `AGENTS.md` protocol ensures that all artifacts are correctly placed and the user is kept informed throughout the process.

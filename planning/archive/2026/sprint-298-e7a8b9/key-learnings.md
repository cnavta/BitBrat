# Key Learnings – sprint-298-e7a8b9

- **Stream Observation Pattern**: Defining observers in Firestore allows for dynamic, configurable analysis without code changes for each stream.
- **MCP for On-Demand Analysis**: Bridging MCP tools to standard service engines provides a powerful way for human-in-the-loop or agent-led data inspection.
- **Token Budgeting**: Always budget for both the stream context and the expected response (especially JSON structure) when setting `maxTokens`.
- **Hybrid Triggers**: Designing services to handle both async Pub/Sub and sync HTTP/MCP calls ensures maximum flexibility for integration.

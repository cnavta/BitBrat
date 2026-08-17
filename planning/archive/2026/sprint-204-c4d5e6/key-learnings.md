# Key Learnings – sprint-204-c4d5e6

- **MCP Tool Registration**: Using Zod for tool schemas provides excellent runtime validation and automatic JSON schema generation for MCP discovery.
- **Cross-Platform Moderation**: Normalizing platform IDs (e.g., `twitch:userId`) allows the Auth service to remain platform-agnostic while the Ingress-Egress service handles the specifics of each connector.
- **Connector Interfacing**: Adding optional methods to the `EgressConnector` interface (like `banUser`) allows for progressive enhancement of connectors without breaking ones that don't support certain features yet.

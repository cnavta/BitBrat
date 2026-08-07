# Key Learnings – sprint-257-a1b2c3

- **Session-Scoped MCP Servers**: For multi-tenant or RBAC-aware MCP gateways, spawning a unique `Server` instance per transport connection is a clean and robust way to enforce different visibility rules without complex interceptors.
- **Circuit Breaker state visibility**: It is beneficial to expose circuit breaker states via metrics or health endpoints to provide early warning of upstream server instability.
- **REST-to-MCP Translation**: Mapping REST endpoints to internal tool execution allows for a unified policy enforcement point (PEP) regardless of the protocol used by the consumer.
- **Propagation of Context**: `ToolExecutionContext` must be propagated through all layers (Registry -> Bridge -> Invoker -> Client) to ensure that downstream services and observability layers have the necessary identity metadata.

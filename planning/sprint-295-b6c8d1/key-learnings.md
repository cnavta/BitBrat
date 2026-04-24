# Key Learnings – sprint-295-b6c8d1

- **Hierarchical Timeout Pattern**: For nested service calls (Event -> App -> Infra), each outer layer MUST be more permissive than the inner layer (e.g., 90s -> 75s -> 60s) to allow for processing overhead and avoid race conditions.
- **Abort Propagation**: In TypeScript/Node, passing `AbortSignal` through the execution context is the most reliable way to handle "Caller Abort" scenarios and prevent background processing of abandoned requests.
- **Observability in Resilience**: Error messages should distinguish between different types of failures (Timeout vs Abort) to help SREs and developers identify which layer is responsible for a failure.
- **Test Fragility**: When changing standardized error messages, be prepared to update unit tests that use regex/string matching on Error objects.

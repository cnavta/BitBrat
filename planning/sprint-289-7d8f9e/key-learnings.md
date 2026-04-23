# Key Learnings – sprint-289-7d8f9e

- **MCP Scalability**: SSE is the preferred transport for serverless MCP servers (Cloud Run).
- **Dependency Management**: Always verify the availability of provider-specific SDKs in the shared environment before relying on them; `fetch` is a reliable universal fallback for REST APIs.
- **Resource Pattern**: The `StorageManager` implementation extends the platform's standard resource pattern, making GCS access consistent across services.
- **Base Class Consistency**: Refactoring to shared base classes (`McpServer`, `BaseServer`) early in a service's lifecycle prevents drift and simplifies platform-wide security and observability updates.
- **Model-Specific Nuances**: Image models (like DALL-E 3) often have different API contract requirements (e.g. `size` vs `aspectRatio`) compared to text models, requiring careful mapping in the tool and provider layers.

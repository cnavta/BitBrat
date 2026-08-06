# Key Learnings – sprint-290-a1b2c3

- **Resilience Overrides**: Providing an optional `optionsOverride` to core resilience logic (like Circuit Breakers and Timeouts) is a robust pattern for supporting both global defaults and specific overrides (e.g., from a database or config registry).
- **McpBridge Pattern**: Passing overrides from `McpClientManager` to `McpBridge` at construction time ensures that all tools, resources, and prompts from a specific server share the same server-specific settings.

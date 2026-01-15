# Key Learnings – sprint-186-a7b8c9

- **GCP Cloud Scheduler + Firestore**: A simple "tick" mechanism is often better than managing individual Cloud Scheduler jobs for each dynamic item, especially when those items are managed via a database.
- **MCP Tool Design**: When designing tools for LLMs, clear descriptions of the payload and schedule format (like ISO strings or Cron) are essential for reliable tool use.
- **Event Flattening**: The transition to `InternalEventV2` makes it much simpler to construct and publish events from internal services without nesting complex envelopes.

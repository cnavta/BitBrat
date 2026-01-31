# Key Learnings – sprint-240-a1b2c3

- **Visibility is Debuggability**: Adding tool call arguments and results to the prompt logs drastically reduces the time needed to debug "why the LLM hallucinated" or "why the tool failed."
- **Metric Consistency**: When adding new metrics like `errorRate`, it's important to ensure they are available at both the individual component level (tools) and the aggregate level (servers).
- **Redaction is Paramount**: Even when logging for debug purposes, we must consistently apply redaction (e.g., via `redactText`) to ensure no PII or secrets leak into the logging database.

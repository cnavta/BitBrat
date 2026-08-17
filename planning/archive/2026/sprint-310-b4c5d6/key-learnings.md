# Key Learnings – sprint-310-b4c5d6

- **Event Enrichment as a Signal:** The `auth-service` is the ideal place to detect lifecycle events like "first message" because it already performs the necessary user lookup and state updates.
- **Side-effect Events:** System events that are side-effects of a main process should be marked with a non-standard routing stage (like `meta`) to avoid interfering with conversation-related routing logic.
- **Environment Robustness:** When running tests in restricted environments, explicitly providing the PATH to tools like `node` or `gh` ensures predictability.

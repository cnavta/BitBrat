# Key Learnings – sprint-294-d2e3f4

- **Hierarchical Timeouts**: In complex distributed systems, timeouts should follow a "Top-Down" hierarchy where the outer layers wait longer than the inner layers.
- **Code vs. Comments**: Always trust the code over JSDoc comments when investigating system behavior.
- **Zombies**: Mismatched timeouts lead to "zombie" processes where a caller has aborted but the server continues to consume resources.

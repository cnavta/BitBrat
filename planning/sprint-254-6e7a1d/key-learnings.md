# Key Learnings - sprint-254-6e7a1d

## Architecture Patterns
- **Mutation-Led State**: Moving from direct database writes to a mutation proposal flow significantly improves auditability and race condition handling.
- **Optimistic Concurrency**: Using version-based checks in Firestore transactions ensures that conflicting LLM and automation updates don't overwrite each other.

## Technical Insights
- **JsonLogic for Rules**: JsonLogic provides a safe, serializable, and powerful way to define rules that can be shared across microservices or stored in configuration.
- **McpServer Reusability**: Using the `McpServer` base class for the `state-engine` makes it easy to expose high-level tools to LLM agents while keeping the implementation details (Firestore/NATS) hidden.

## Best Practices
- **Actor Attribution**: Always including the `actor` and `reason` in every mutation payload is critical for debugging why a state changed (e.g., "Was it the Twitch EventSub or an LLM bot command?").
- **Key Allowlisting**: Restricting which state keys can be mutated via public/agent-facing APIs is a core security requirement.

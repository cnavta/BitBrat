# Key Learnings – sprint-308-f1e2d3

- **Semantic Prompting**: Using named contexts (e.g., "World State", "Adventure Meta") instead of serialized JSON blocks improves LLM attention and instruction following.
- **Section Ordering**: Placing Contexts after Conversation State but before Tasks/Constraints ensures the model has the background information before receiving specific instructions.
- **Extensible Types**: The `NamedContext` pattern is highly reusable for other services beyond the Story Engine (e.g., RDB data, external API snippets).
